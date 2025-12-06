/**
 * Ledger Event Processor
 * Streams transactions from Canton and updates off-chain projections
 */

import type { Database as BunDatabase } from "bun:sqlite";
import type { CantonLedgerClient } from "../canton/client";
import type { TransactionEvent, LedgerEvent } from "../canton/types";
import { Templates } from "../canton/templates";
import { getLastProcessedOffset, setLastProcessedOffset, withTransactionAsync } from "../db/database";
import type { BalanceProjectionService } from "../projections/balance.projection";
import type { PositionProjectionService } from "../projections/position.projection";
import type { MarketProjectionService } from "../projections/market.projection";
import type { PositionSide } from "../projections/position.projection";
import type { MarketStatus } from "../projections/market.projection";
import type { EventProcessorConfig, EventProcessorStatus } from "./types";
import { DEFAULT_EVENT_PROCESSOR_CONFIG, parseTemplateId } from "./types";
import { logApp, logAppError, logAppWarn, logLedgerEvent } from "../utils/logger";

/**
 * LedgerEventProcessor streams transactions from Canton's ledger
 * and updates off-chain projections in real-time.
 *
 * Features:
 * - SSE-based streaming from Canton /v2/updates endpoint
 * - Automatic reconnection with exponential backoff
 * - Offset checkpointing for crash recovery
 * - Transactional event processing (all events in a tx processed atomically)
 * - Dispatches to appropriate projection services by template type
 */
export class LedgerEventProcessor {
    // State
    private isRunning = false;
    private currentOffset: string | null = null;
    private reconnectDelay: number;
    private reconnectAttempts = 0;
    private lastEventTime: Date | null = null;
    private eventsProcessed = 0;
    private errors = 0;

    constructor(
        private readonly cantonClient: CantonLedgerClient,
        private readonly db: BunDatabase,
        private readonly balanceProjection: BalanceProjectionService,
        private readonly positionProjection: PositionProjectionService,
        private readonly marketProjection: MarketProjectionService,
        private readonly config: EventProcessorConfig = DEFAULT_EVENT_PROCESSOR_CONFIG,
    ) {
        this.reconnectDelay = config.initialReconnectDelayMs;
    }

    // ============================================
    // Public API
    // ============================================

    /**
     * Start streaming transactions from Canton
     * Runs indefinitely until stop() is called
     *
     * This method runs in the background and handles reconnection automatically.
     * It should be called once during application startup.
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            logAppWarn("EventProcessor", "Already running");
            return;
        }

        this.isRunning = true;
        logApp("EventProcessor", "Starting event stream");

        // Main streaming loop with automatic reconnection
        while (this.isRunning) {
            try {
                await this.streamEvents();

                // Stream ended without error (connection closed normally)
                // Wait before reconnecting to avoid tight loop
                if (this.isRunning) {
                    // Use a minimum reconnect delay to prevent spam
                    const delay = Math.max(this.reconnectDelay, 5000);
                    if (this.reconnectAttempts === 0) {
                        // First reconnect after clean close - log it
                        logApp("EventProcessor", "Stream ended, reconnecting", { delayMs: delay });
                    }
                    await this.sleep(delay);
                    this.reconnectAttempts++;
                }
            } catch (error) {
                this.errors++;
                // Only log errors on first occurrence or periodically
                if (this.reconnectAttempts === 0 || this.reconnectAttempts % 10 === 0) {
                    logAppError("EventProcessor", "Stream error", error);
                }

                if (this.isRunning) {
                    if (this.reconnectAttempts === 0) {
                        logApp("EventProcessor", "Reconnecting", { delayMs: this.reconnectDelay });
                    }
                    await this.sleep(this.reconnectDelay);

                    // Exponential backoff
                    this.reconnectDelay = Math.min(this.reconnectDelay * this.config.reconnectMultiplier, this.config.maxReconnectDelayMs);
                    this.reconnectAttempts++;
                }
            }
        }

        logApp("EventProcessor", "Stopped");
    }

    /**
     * Stop the event processor gracefully
     */
    stop(): void {
        logApp("EventProcessor", "Stopping");
        this.isRunning = false;
    }

    /**
     * Get current processor status for monitoring
     */
    getStatus(): EventProcessorStatus {
        return {
            isRunning: this.isRunning,
            currentOffset: this.currentOffset,
            lastEventTime: this.lastEventTime,
            reconnectAttempts: this.reconnectAttempts,
            eventsProcessed: this.eventsProcessed,
            errors: this.errors,
        };
    }

    // ============================================
    // Streaming Logic
    // ============================================

    /**
     * Main streaming logic - connects to Canton and processes events
     */
    private async streamEvents(): Promise<void> {
        // Load last processed offset from DB for crash recovery
        this.currentOffset = getLastProcessedOffset(this.db) || "0";

        // Only log on first connection or after errors
        const isFirstConnection = this.reconnectAttempts === 0;
        if (isFirstConnection) {
            logApp("EventProcessor", "Resuming from offset", { offset: this.currentOffset });
        }

        // Start streaming from Canton
        const stream = this.cantonClient.streamTransactions({
            beginOffset: this.currentOffset,
            templateIds: this.getTemplateIdsToTrack(),
        });

        // Reset reconnect delay on successful connection
        this.reconnectDelay = this.config.initialReconnectDelayMs;

        if (isFirstConnection) {
            logApp("EventProcessor", "Connected to Canton stream");
        }

        // Process each transaction as it arrives
        for await (const tx of stream) {
            if (!this.isRunning) break;

            await this.processTransaction(tx);

            // Checkpoint offset after each transaction
            this.currentOffset = tx.offset;
            setLastProcessedOffset(this.db, tx.offset);

            this.lastEventTime = new Date();

            // Reset reconnect attempts on successful event processing
            this.reconnectAttempts = 0;
        }
    }

    /**
     * Get template IDs to track in the stream
     */
    private getTemplateIdsToTrack(): string[] {
        return [
            Templates.TradingAccount,
            Templates.TradingAccountRequest,
            Templates.PebbleAuthorization,
            Templates.Position,
            Templates.Market,
            Templates.Settlement,
            Templates.SettlementProposal,
            Templates.SettlementProposalAccepted,
            Templates.MarketSettlement,
        ];
    }

    // ============================================
    // Transaction Processing
    // ============================================

    /**
     * Process all events in a transaction atomically
     *
     * Events within a single Canton transaction are processed within
     * a SQLite transaction to maintain consistency. If any event fails,
     * the entire transaction is rolled back and the offset is not saved.
     */
    private async processTransaction(tx: TransactionEvent): Promise<void> {
        if (tx.events.length === 0) return;

        await withTransactionAsync(this.db, async () => {
            for (const event of tx.events) {
                await this.processEvent(event, tx.transactionId);
                this.eventsProcessed++;
            }
        });
    }

    /**
     * Process a single ledger event by dispatching to the appropriate handler
     */
    private async processEvent(event: LedgerEvent, transactionId: string): Promise<void> {
        const parsed = parseTemplateId(event.templateId);
        if (!parsed) {
            // Not a recognized template format, skip
            return;
        }

        // Dispatch to appropriate handler based on template name
        switch (parsed.template) {
            case "TradingAccount":
                await this.handleTradingAccountEvent(event);
                break;

            case "Position":
                await this.handlePositionEvent(event);
                break;

            case "Market":
                await this.handleMarketEvent(event);
                break;

            case "Settlement":
                await this.handleSettlementEvent(event, transactionId);
                break;

            case "MarketSettlement":
                await this.handleMarketSettlementEvent(event);
                break;

            // These templates are tracked for completeness but don't need projection updates
            case "TradingAccountRequest":
            case "PebbleAuthorization":
            case "SettlementProposal":
            case "SettlementProposalAccepted":
                // Audit logging only
                break;

            default:
                // Unknown template, ignore
                break;
        }
    }

    // ============================================
    // Event Handlers
    // ============================================

    /**
     * Handle TradingAccount events (balance projection)
     */
    private async handleTradingAccountEvent(event: LedgerEvent): Promise<void> {
        if (event.eventType === "created" && event.createArguments) {
            const args = event.createArguments;

            // Extract balance fields from the contract
            const owner = args.owner as string;
            const availableBalance = String(args.availableBalance ?? "0");
            const lockedBalance = String(args.lockedBalance ?? "0");

            logLedgerEvent("created", "TradingAccount", event.contractId, {
                party: owner,
                available: availableBalance,
                locked: lockedBalance,
            });

            await this.balanceProjection.handleAccountCreated(event.contractId, owner, availableBalance, lockedBalance);
        } else if (event.eventType === "archived") {
            logLedgerEvent("archived", "TradingAccount", event.contractId);
        }
    }

    /**
     * Handle Position events (position projection)
     */
    private async handlePositionEvent(event: LedgerEvent): Promise<void> {
        if (event.eventType === "created" && event.createArguments) {
            const args = event.createArguments;

            // Extract position fields from the contract
            const owner = args.owner as string;
            const marketId = args.marketId as string;
            const side = String(args.side ?? "YES").toLowerCase() as PositionSide;
            const quantity = String(args.quantity ?? "0");
            const lockedQuantity = String(args.lockedQuantity ?? "0");
            const avgCostBasis = String(args.avgCostBasis ?? "0");

            logLedgerEvent("created", "Position", event.contractId, {
                party: owner,
                marketId,
                side,
                quantity,
            });

            await this.positionProjection.handlePositionCreated(
                event.contractId,
                owner,
                marketId,
                side,
                quantity,
                lockedQuantity,
                avgCostBasis,
            );
        } else if (event.eventType === "archived") {
            logLedgerEvent("archived", "Position", event.contractId);
            await this.positionProjection.handlePositionArchived(event.contractId);
        }
    }

    /**
     * Handle Market events (market projection)
     */
    private async handleMarketEvent(event: LedgerEvent): Promise<void> {
        if (event.eventType === "created" && event.createArguments) {
            const args = event.createArguments;

            // Extract market fields from the contract
            const marketId = args.marketId as string;
            const question = args.question as string;
            const description = args.description as string;
            const resolutionTime = args.resolutionTime as string;
            const status = String(args.status ?? "Open").toLowerCase() as MarketStatus;
            const outcome = args.outcome as boolean | undefined;
            const version = (args.version as number) ?? 0;

            logLedgerEvent("created", "Market", event.contractId, {
                marketId,
                status,
                version: String(version),
            });

            await this.marketProjection.handleMarketCreated(
                event.contractId,
                marketId,
                question,
                description,
                resolutionTime,
                status,
                outcome,
                version,
            );
        } else if (event.eventType === "archived") {
            logLedgerEvent("archived", "Market", event.contractId);
        }
    }

    /**
     * Handle Settlement events (audit logging)
     *
     * Settlement execution creates TradingAccount and Position events
     * which are handled by their respective projections. This handler
     * is primarily for audit logging.
     */
    private async handleSettlementEvent(event: LedgerEvent, transactionId: string): Promise<void> {
        if (event.eventType === "created" && event.createArguments) {
            const args = event.createArguments;
            logLedgerEvent("created", "Settlement", event.contractId, {
                txId: transactionId,
                proposalId: args.proposalId as string,
            });
        } else if (event.eventType === "archived") {
            logLedgerEvent("archived", "Settlement", event.contractId);
        }
    }

    /**
     * Handle MarketSettlement events (market resolution)
     */
    private async handleMarketSettlementEvent(event: LedgerEvent): Promise<void> {
        if (event.eventType === "created" && event.createArguments) {
            const args = event.createArguments;

            const marketId = args.marketId as string;
            const outcome = args.outcome as boolean;

            logLedgerEvent("created", "MarketSettlement", event.contractId, {
                marketId,
                outcome: outcome ? "YES" : "NO",
            });

            await this.marketProjection.handleMarketResolved(marketId, outcome);
        }
    }

    // ============================================
    // Utilities
    // ============================================

    /**
     * Sleep for the specified duration
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
