/**
 * Settlement Service
 *
 * Processes matched trades from the OrderService and executes the three-stage
 * settlement pattern on Canton. Batches trades for efficiency, handles UTXO
 * contention via round-based execution, and provides retry/compensation mechanisms.
 *
 * Three-Stage Settlement Flow:
 * 1. Create SettlementProposal (pebbleAdmin is sole signatory)
 * 2a. BuyerAccept -> SettlementProposalAccepted
 * 2b. SellerAccept -> Settlement
 * 3. ExecuteSettlement (with all three parties as signatories)
 */

import Decimal from "decimal.js";
import type { CantonLedgerClient } from "../canton/client";
import { createCommand, exerciseCommand, generateCommandId } from "../canton/client";
import { Templates, Choices } from "../canton/templates";
import type { TradeRepository } from "../db/repositories/trade.repository";
import type { SettlementRepository } from "../db/repositories/settlement.repository";
import type { AccountRepository } from "../db/repositories/account.repository";
import type { PositionRepository } from "../db/repositories/position.repository";
import type { MarketRepository } from "../db/repositories/market.repository";
import type { Trade, SettlementBatch, TradingAccount, Position } from "../types";
import type { SettlementServiceConfig, SettlementServiceStatus } from "./settlement.types";
import { wsManager } from "../api/websocket/ws-manager";
import { logWsBroadcast, logWsUserMessage } from "../utils/logger";

// ============================================
// Settlement Service
// ============================================

export class SettlementService {
    // Configuration
    private readonly batchIntervalMs: number;
    private readonly maxBatchSize: number;
    private readonly maxRetries: number;
    private readonly roundDelayMs: number;

    // State
    private pendingTrades: Trade[] = [];
    private isProcessing = false;
    private batchTimer: Timer | null = null;
    private isShuttingDown = false;
    private lastBatchTime: Date | null = null;
    private batchesCompleted = 0;
    private batchesFailed = 0;

    constructor(
        private cantonClient: CantonLedgerClient | null,
        private tradeRepo: TradeRepository,
        private settlementRepo: SettlementRepository,
        private accountRepo: AccountRepository,
        private positionRepo: PositionRepository,
        private marketRepo: MarketRepository,
        private config: SettlementServiceConfig,
    ) {
        this.batchIntervalMs = config.batchIntervalMs;
        this.maxBatchSize = config.maxBatchSize;
        this.maxRetries = config.maxRetries;
        this.roundDelayMs = config.roundDelayMs;
    }

    // ============================================
    // Public API
    // ============================================

    /**
     * Initialize the settlement service
     * Starts the batch processing loop and recovers pending batches
     */
    initialize(): void {
        console.log("[SettlementService] Initializing...");

        // Recover any incomplete batches from previous run
        this.recoverPendingBatches();

        // Start the batch processing loop
        this.startBatchLoop();

        console.log(
            `[SettlementService] Initialized (interval: ${this.batchIntervalMs}ms, maxBatch: ${this.maxBatchSize})`,
        );
    }

    /**
     * Gracefully shutdown the settlement service
     */
    async shutdown(): Promise<void> {
        console.log("[SettlementService] Shutting down...");
        this.isShuttingDown = true;
        this.stopBatchLoop();

        // Wait for current batch to complete
        while (this.isProcessing) {
            await this.sleep(100);
        }

        console.log("[SettlementService] Shutdown complete");
    }

    /**
     * Queue a trade for settlement
     * Called by OrderService after matching
     */
    queueTrade(trade: Trade): void {
        if (this.isShuttingDown) {
            console.warn(`[SettlementService] Cannot queue trade ${trade.tradeId} - service is shutting down`);
            return;
        }

        this.pendingTrades.push(trade);
        this.log(`Queued trade ${trade.tradeId} for settlement`);

        // Trigger immediate processing if batch size reached
        if (this.pendingTrades.length >= this.maxBatchSize) {
            this.processBatch().catch((e) => this.logError("Immediate batch processing failed", e));
        }
    }

    /**
     * Queue multiple trades for settlement
     */
    queueTrades(trades: Trade[]): void {
        for (const trade of trades) {
            this.queueTrade(trade);
        }
    }

    /**
     * Get the current status of the settlement service
     */
    getStatus(): SettlementServiceStatus {
        return {
            pendingCount: this.pendingTrades.length,
            isProcessing: this.isProcessing,
            lastBatchTime: this.lastBatchTime,
            batchesCompleted: this.batchesCompleted,
            batchesFailed: this.batchesFailed,
            isShuttingDown: this.isShuttingDown,
        };
    }

    /**
     * Manually retry a failed batch
     */
    async retryBatch(batchId: string): Promise<void> {
        const batch = this.settlementRepo.getBatchById(batchId);
        if (!batch) {
            throw new Error(`Batch not found: ${batchId}`);
        }

        if (batch.status !== "failed") {
            throw new Error(`Cannot retry batch with status ${batch.status}`);
        }

        // Get trades for this batch
        const trades = batch.tradeIds.map((id) => this.tradeRepo.getById(id)).filter((t): t is Trade => t !== null);

        if (trades.length === 0) {
            throw new Error(`No trades found for batch ${batchId}`);
        }

        // Reset batch status
        this.settlementRepo.updateBatchStatus(batchId, "pending");

        // Re-queue trades
        this.pendingTrades.push(...trades);

        this.log(`Re-queued batch ${batchId} with ${trades.length} trades`);
    }

    // ============================================
    // Batch Processing Loop
    // ============================================

    private startBatchLoop(): void {
        if (this.batchTimer) {
            return;
        }

        this.batchTimer = setInterval(async () => {
            if (!this.isProcessing && !this.isShuttingDown) {
                await this.processBatch().catch((e) => this.logError("Batch processing failed", e));
            }
        }, this.batchIntervalMs);

        this.log("Batch loop started");
    }

    private stopBatchLoop(): void {
        if (this.batchTimer) {
            clearInterval(this.batchTimer);
            this.batchTimer = null;
            this.log("Batch loop stopped");
        }
    }

    /**
     * Process a batch of pending trades
     */
    private async processBatch(): Promise<void> {
        // Guards
        if (this.isProcessing || this.isShuttingDown) {
            return;
        }

        // Check for pending trades from database (polling approach)
        const dbPendingTrades = this.tradeRepo.getPendingTrades(this.maxBatchSize - this.pendingTrades.length);
        for (const trade of dbPendingTrades) {
            // Avoid duplicates
            if (!this.pendingTrades.find((t) => t.tradeId === trade.tradeId)) {
                this.pendingTrades.push(trade);
            }
        }

        if (this.pendingTrades.length === 0) {
            return;
        }

        this.isProcessing = true;
        const batch = this.pendingTrades.splice(0, this.maxBatchSize);
        const batchId = this.generateBatchId();

        this.log(`Processing batch ${batchId} with ${batch.length} trades`);

        try {
            // Create batch record in database
            const settlementBatch: SettlementBatch = {
                batchId,
                tradeIds: batch.map((t) => t.tradeId),
                status: "pending",
                createdAt: new Date(),
                retryCount: 0,
            };
            this.settlementRepo.createBatch(settlementBatch);

            // Update trade statuses to "settling"
            for (const trade of batch) {
                this.tradeRepo.updateSettlementStatus(trade.tradeId, "settling", batchId);
            }

            // Order trades to minimize contention
            const orderedBatch = this.orderTradesForSettlement(batch);

            // Stage 1: Create settlement proposals
            this.settlementRepo.updateBatchStatus(batchId, "proposing");
            const proposalCids = await this.createSettlementProposals(orderedBatch, batchId);

            // Stage 2: Accept proposals (buyer then seller)
            this.settlementRepo.updateBatchStatus(batchId, "accepting");
            const acceptedCids = await this.acceptBuyerProposals(proposalCids, orderedBatch, batchId);
            const settlementCids = await this.acceptSellerProposals(acceptedCids, orderedBatch, batchId);

            // Stage 3: Execute settlements
            this.settlementRepo.updateBatchStatus(batchId, "executing");
            const lastTxId = await this.executeSettlements(settlementCids, orderedBatch, batchId);

            // Mark batch as completed
            this.settlementRepo.updateBatchStatus(batchId, "completed");
            this.settlementRepo.setBatchCantonTxId(batchId, lastTxId);

            // Update all trades as settled and update positions/balances
            const now = new Date();
            for (const trade of batch) {
                this.tradeRepo.updateSettlementStatus(trade.tradeId, "settled", batchId);
                // Update positions and balances in database
                this.updatePositionsAndBalances(trade);
            }

            // WebSocket broadcasts for settlement completion
            this.broadcastSettlementComplete(batch, batchId);

            this.lastBatchTime = now;
            this.batchesCompleted++;
            this.log(`Batch ${batchId} completed successfully`);
        } catch (error) {
            this.logError(`Batch ${batchId} failed`, error);
            await this.handleBatchFailure(batchId, batch, error);
        } finally {
            this.isProcessing = false;
        }
    }

    // ============================================
    // Stage 1: Create Settlement Proposals
    // ============================================

    /**
     * Create SettlementProposal contracts on Canton
     * pebbleAdmin is the sole signatory, so we can create directly
     */
    private async createSettlementProposals(trades: Trade[], batchId: string): Promise<Map<string, string>> {
        const proposalCids = new Map<string, string>();

        if (!this.cantonClient) {
            this.log("Canton offline - skipping proposal creation");
            return proposalCids;
        }

        for (const trade of trades) {
            const proposalId = this.generateProposalId(batchId, trade.tradeId);

            // Get market contract ID for verification
            const market = this.marketRepo.getById(trade.marketId);
            if (!market?.contractId) {
                throw new Error(`Market contract not found for trade ${trade.tradeId}`);
            }

            // Get seller's locked position quantity for ShareTrade
            let sellerPositionLockedQuantity: string | null = null;
            if (trade.tradeType === "share_trade") {
                const sellerPosition = this.positionRepo.getByUserMarketSide(
                    trade.sellerId,
                    trade.marketId,
                    trade.side,
                );
                if (sellerPosition) {
                    sellerPositionLockedQuantity = sellerPosition.lockedQuantity.toString();
                }
            }

            // Build create arguments matching Daml template
            const createArgs = {
                pebbleAdmin: this.config.pebbleAdminParty,
                buyer: trade.buyerId,
                seller: trade.sellerId,
                marketId: trade.marketId,
                side: trade.side.toUpperCase(), // "YES" or "NO"
                quantity: trade.quantity.toString(),
                price: trade.price.toString(),
                proposalId,
                createdAt: new Date().toISOString(),
                tradeType: trade.tradeType === "share_creation" ? "ShareCreation" : "ShareTrade",
                sellerPositionLockedQuantity,
                marketContractId: market.contractId,
            };

            try {
                const result = await this.cantonClient.submitCommand({
                    userId: "pebble-settlement-service",
                    commandId: generateCommandId(`create-proposal-${proposalId}`),
                    actAs: [this.config.pebbleAdminParty],
                    readAs: [this.config.pebbleAdminParty],
                    commands: [createCommand(Templates.SettlementProposal, createArgs)],
                });

                const proposalCid = result.contractId;
                if (!proposalCid) {
                    throw new Error("No contract ID returned from proposal creation");
                }

                proposalCids.set(trade.tradeId, proposalCid);

                // Log settlement event
                this.settlementRepo.createEvent({
                    contractId: proposalCid,
                    settlementId: proposalId,
                    transactionId: result.transactionId,
                    status: "proposal_created",
                    timestamp: new Date(),
                });

                this.log(`Created proposal ${proposalId} for trade ${trade.tradeId}`);
            } catch (error) {
                this.logError(`Failed to create proposal for trade ${trade.tradeId}`, error);
                throw error;
            }
        }

        return proposalCids;
    }

    // ============================================
    // Stage 2: Accept Proposals
    // ============================================

    /**
     * Buyer accepts proposals -> creates SettlementProposalAccepted
     */
    private async acceptBuyerProposals(
        proposalCids: Map<string, string>,
        trades: Trade[],
        batchId: string,
    ): Promise<Map<string, string>> {
        const acceptedCids = new Map<string, string>();

        if (!this.cantonClient) {
            this.log("Canton offline - skipping buyer acceptance");
            return acceptedCids;
        }

        for (const trade of trades) {
            const proposalCid = proposalCids.get(trade.tradeId);
            if (!proposalCid) {
                throw new Error(`No proposal CID for trade ${trade.tradeId}`);
            }

            try {
                const result = await this.cantonClient.submitCommand({
                    userId: "pebble-settlement-service",
                    commandId: generateCommandId(`buyer-accept-${batchId}-${trade.tradeId}`),
                    actAs: [trade.buyerId, this.config.pebbleAdminParty],
                    readAs: [this.config.pebbleAdminParty],
                    commands: [
                        exerciseCommand(
                            Templates.SettlementProposal,
                            proposalCid,
                            Choices.SettlementProposal.BuyerAccept,
                            {},
                        ),
                    ],
                });

                const acceptedCid = result.contractId;
                if (!acceptedCid) {
                    throw new Error("No contract ID returned from buyer acceptance");
                }

                acceptedCids.set(trade.tradeId, acceptedCid);

                // Log settlement event
                this.settlementRepo.createEvent({
                    contractId: acceptedCid,
                    settlementId: this.generateProposalId(batchId, trade.tradeId),
                    transactionId: result.transactionId,
                    status: "buyer_accepted",
                    timestamp: new Date(),
                });

                this.log(`Buyer accepted for trade ${trade.tradeId}`);
            } catch (error) {
                this.logError(`Buyer acceptance failed for trade ${trade.tradeId}`, error);
                throw error;
            }
        }

        return acceptedCids;
    }

    /**
     * Seller accepts proposals -> creates Settlement contracts
     */
    private async acceptSellerProposals(
        acceptedCids: Map<string, string>,
        trades: Trade[],
        batchId: string,
    ): Promise<Map<string, string>> {
        const settlementCids = new Map<string, string>();

        if (!this.cantonClient) {
            this.log("Canton offline - skipping seller acceptance");
            return settlementCids;
        }

        for (const trade of trades) {
            const acceptedCid = acceptedCids.get(trade.tradeId);
            if (!acceptedCid) {
                throw new Error(`No accepted proposal CID for trade ${trade.tradeId}`);
            }

            try {
                const result = await this.cantonClient.submitCommand({
                    userId: "pebble-settlement-service",
                    commandId: generateCommandId(`seller-accept-${batchId}-${trade.tradeId}`),
                    actAs: [trade.sellerId, this.config.pebbleAdminParty],
                    readAs: [this.config.pebbleAdminParty],
                    commands: [
                        exerciseCommand(
                            Templates.SettlementProposalAccepted,
                            acceptedCid,
                            Choices.SettlementProposalAccepted.SellerAccept,
                            {},
                        ),
                    ],
                });

                const settlementCid = result.contractId;
                if (!settlementCid) {
                    throw new Error("No contract ID returned from seller acceptance");
                }

                settlementCids.set(trade.tradeId, settlementCid);

                // Log settlement event
                this.settlementRepo.createEvent({
                    contractId: settlementCid,
                    settlementId: this.generateProposalId(batchId, trade.tradeId),
                    transactionId: result.transactionId,
                    status: "seller_accepted",
                    timestamp: new Date(),
                });

                this.log(`Seller accepted for trade ${trade.tradeId}`);
            } catch (error) {
                this.logError(`Seller acceptance failed for trade ${trade.tradeId}`, error);
                throw error;
            }
        }

        return settlementCids;
    }

    // ============================================
    // Stage 3: Execute Settlements
    // ============================================

    /**
     * Execute settlements with round-based grouping to avoid UTXO contention
     */
    private async executeSettlements(
        settlementCids: Map<string, string>,
        trades: Trade[],
        batchId: string,
    ): Promise<string> {
        if (!this.cantonClient) {
            this.log("Canton offline - skipping settlement execution");
            return "";
        }

        // Group trades into rounds where no user appears twice
        const rounds = this.groupTradesIntoRounds(trades);
        this.log(`Executing ${rounds.length} rounds for batch ${batchId}`);

        let lastTransactionId = "";

        for (let roundIndex = 0; roundIndex < rounds.length; roundIndex++) {
            const roundTrades = rounds[roundIndex];
            this.log(`Executing round ${roundIndex + 1}/${rounds.length} with ${roundTrades.length} trades`);

            const commands = [];
            const roundParties = new Set<string>();
            roundParties.add(this.config.pebbleAdminParty);

            for (const trade of roundTrades) {
                const settlementCid = settlementCids.get(trade.tradeId);
                if (!settlementCid) {
                    throw new Error(`No settlement CID for trade ${trade.tradeId} in round ${roundIndex}`);
                }

                // Fetch FRESH contract IDs (may have changed in previous rounds)
                const buyerAccount = await this.getAccountContractWithRetry(trade.buyerId);
                const sellerAccount = await this.getAccountContractWithRetry(trade.sellerId);

                // Determine position side based on trade type
                const buyerPositionSide = trade.tradeType === "share_creation" ? "yes" : trade.side;
                const sellerPositionSide = trade.tradeType === "share_creation" ? "no" : trade.side;

                const buyerPosition = await this.getPositionContract(trade.buyerId, trade.marketId, buyerPositionSide);
                const sellerPosition = await this.getPositionContract(
                    trade.sellerId,
                    trade.marketId,
                    sellerPositionSide,
                );

                // Build ExecuteSettlement command
                commands.push(
                    exerciseCommand(Templates.Settlement, settlementCid, Choices.Settlement.ExecuteSettlement, {
                        buyerAccountCid: buyerAccount.contractId,
                        sellerAccountCid: sellerAccount.contractId,
                        buyerPositionCid: buyerPosition?.contractId ?? null,
                        sellerPositionCid: sellerPosition?.contractId ?? null,
                    }),
                );

                roundParties.add(trade.buyerId);
                roundParties.add(trade.sellerId);
            }

            try {
                const result = await this.cantonClient.submitCommand({
                    userId: "pebble-settlement-service",
                    commandId: generateCommandId(`execute-batch-${batchId}-round-${roundIndex}`),
                    actAs: Array.from(roundParties),
                    readAs: [this.config.pebbleAdminParty],
                    commands,
                });

                lastTransactionId = result.transactionId;

                // Log settlement events for each trade in the round
                for (const trade of roundTrades) {
                    const settlementCid = settlementCids.get(trade.tradeId);
                    this.settlementRepo.createEvent({
                        contractId: settlementCid!,
                        settlementId: this.generateProposalId(batchId, trade.tradeId),
                        transactionId: result.transactionId,
                        status: "executed",
                        timestamp: new Date(),
                    });
                }

                this.log(`Round ${roundIndex + 1} executed successfully (tx: ${result.transactionId})`);
            } catch (error) {
                this.logError(`Round ${roundIndex + 1} execution failed`, error);
                throw error;
            }

            // Brief delay between rounds to allow Canton to process
            if (roundIndex < rounds.length - 1) {
                await this.sleep(this.roundDelayMs);
            }
        }

        return lastTransactionId;
    }

    // ============================================
    // UTXO Contention Handling
    // ============================================

    /**
     * Group trades into rounds where no user appears more than once per round.
     * This ensures UTXO constraints are satisfied within each Canton command.
     */
    private groupTradesIntoRounds(trades: Trade[]): Trade[][] {
        const rounds: Trade[][] = [];
        const processedTradeIds = new Set<string>();

        while (processedTradeIds.size < trades.length) {
            const round: Trade[] = [];
            const usersInRound = new Set<string>();

            for (const trade of trades) {
                if (processedTradeIds.has(trade.tradeId)) continue;

                // Check if this trade would cause contention in this round
                const hasContention = usersInRound.has(trade.buyerId) || usersInRound.has(trade.sellerId);

                if (!hasContention) {
                    round.push(trade);
                    processedTradeIds.add(trade.tradeId);
                    usersInRound.add(trade.buyerId);
                    usersInRound.add(trade.sellerId);
                }
            }

            if (round.length > 0) {
                rounds.push(round);
            } else {
                // Safety: shouldn't happen, but prevent infinite loop
                console.error("[SettlementService] Failed to make progress in groupTradesIntoRounds");
                break;
            }
        }

        return rounds;
    }

    /**
     * Order trades within a batch to minimize contention.
     * Trades with no contention go first, followed by ordered contention trades.
     */
    private orderTradesForSettlement(trades: Trade[]): Trade[] {
        if (trades.length <= 1) return trades;

        // Group trades by user (both buyer and seller sides)
        const userTrades = new Map<string, Trade[]>();

        for (const trade of trades) {
            if (!userTrades.has(trade.buyerId)) {
                userTrades.set(trade.buyerId, []);
            }
            userTrades.get(trade.buyerId)!.push(trade);

            if (trade.sellerId !== trade.buyerId) {
                if (!userTrades.has(trade.sellerId)) {
                    userTrades.set(trade.sellerId, []);
                }
                userTrades.get(trade.sellerId)!.push(trade);
            }
        }

        // Find users with multiple trades (contention risk)
        const contentionUsers = Array.from(userTrades.entries())
            .filter(([_, userTradeList]) => userTradeList.length > 1)
            .map(([userId]) => userId);

        if (contentionUsers.length === 0) {
            // No contention - return as-is
            return trades;
        }

        // For users with contention, sort their trades by creation time
        for (const userId of contentionUsers) {
            userTrades.get(userId)!.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        }

        // Build ordered result
        const noContentionTrades: Trade[] = [];
        const contentionTrades: Trade[] = [];
        const processedTradeIds = new Set<string>();

        // First pass: trades with no contention
        for (const trade of trades) {
            const buyerHasContention = contentionUsers.includes(trade.buyerId);
            const sellerHasContention = contentionUsers.includes(trade.sellerId);

            if (!buyerHasContention && !sellerHasContention) {
                noContentionTrades.push(trade);
                processedTradeIds.add(trade.tradeId);
            }
        }

        // Second pass: trades with contention, ordered by rounds
        while (processedTradeIds.size < trades.length) {
            const usersInRound = new Set<string>();
            let addedThisRound = false;

            for (const userId of contentionUsers) {
                const userTradeList = userTrades.get(userId)!;
                for (const trade of userTradeList) {
                    if (processedTradeIds.has(trade.tradeId)) continue;
                    if (usersInRound.has(trade.buyerId) || usersInRound.has(trade.sellerId)) continue;

                    contentionTrades.push(trade);
                    processedTradeIds.add(trade.tradeId);
                    usersInRound.add(trade.buyerId);
                    usersInRound.add(trade.sellerId);
                    addedThisRound = true;
                    break; // Only one trade per user per round
                }
            }

            if (!addedThisRound) {
                // Safety: add any remaining trades
                for (const trade of trades) {
                    if (!processedTradeIds.has(trade.tradeId)) {
                        contentionTrades.push(trade);
                        processedTradeIds.add(trade.tradeId);
                    }
                }
            }
        }

        return [...noContentionTrades, ...contentionTrades];
    }

    // ============================================
    // Contract Queries
    // ============================================

    /**
     * Get account contract with retry logic for stale contract IDs.
     * Always queries Canton to get the freshest contract ID and updates the database.
     */
    private async getAccountContractWithRetry(
        userId: string,
        maxRetries: number = 3,
    ): Promise<{ contractId: string; payload: TradingAccount }> {
        let lastError: Error | undefined;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // Always query Canton for fresh contract ID during settlement
                // because previous operations may have created new contracts
                if (this.cantonClient) {
                    const contracts = await this.cantonClient.getActiveContracts<{
                        owner: string;
                        availableBalance: string;
                        lockedBalance: string;
                    }>({
                        templateId: Templates.TradingAccount,
                        party: this.config.pebbleAdminParty,
                    });

                    const userContract = contracts.find((c) => c.payload.owner === userId);
                    if (userContract) {
                        // Update database with fresh contract ID from Canton
                        const cachedAccount = this.accountRepo.getById(userId);
                        if (cachedAccount && cachedAccount.accountContractId !== userContract.contractId) {
                            this.log(
                                `Updating stale contract ID for ${userId}: ${cachedAccount.accountContractId?.slice(0, 20)}... -> ${userContract.contractId.slice(0, 20)}...`,
                            );
                            this.accountRepo.updateAccountContractId(userId, userContract.contractId);
                        }

                        return {
                            contractId: userContract.contractId,
                            payload: {
                                userId,
                                partyId: userId,
                                accountContractId: userContract.contractId,
                                availableBalance: userContract.payload
                                    .availableBalance as unknown as import("decimal.js").default,
                                lockedBalance: userContract.payload
                                    .lockedBalance as unknown as import("decimal.js").default,
                                lastUpdated: new Date(),
                            },
                        };
                    }
                }

                // Fall back to local cache if Canton is offline
                const account = this.accountRepo.getById(userId);
                if (account?.accountContractId) {
                    return {
                        contractId: account.accountContractId,
                        payload: account,
                    };
                }

                throw new Error(`Account not found for user ${userId}`);
            } catch (error) {
                lastError = error as Error;
                if (attempt < maxRetries - 1) {
                    await this.sleep(100 * (attempt + 1)); // Exponential backoff
                }
            }
        }

        throw lastError || new Error(`Failed to get account for ${userId}`);
    }

    /**
     * Get position contract for a user
     */
    private async getPositionContract(
        userId: string,
        marketId: string,
        side: string,
    ): Promise<{ contractId: string; payload: Position } | null> {
        // First try local cache
        const position = this.positionRepo.getByUserMarketSide(userId, marketId, side as "yes" | "no");
        if (position) {
            return {
                contractId: position.positionId,
                payload: position,
            };
        }

        // Fall back to Canton query
        if (this.cantonClient) {
            try {
                const contracts = await this.cantonClient.getActiveContracts<{
                    owner: string;
                    marketId: string;
                    side: string;
                    quantity: string;
                    lockedQuantity: string;
                    avgCostBasis: string;
                }>({
                    templateId: Templates.Position,
                    party: this.config.pebbleAdminParty,
                });

                const userPosition = contracts.find(
                    (c) =>
                        c.payload.owner === userId &&
                        c.payload.marketId === marketId &&
                        c.payload.side === side.toUpperCase(),
                );

                if (userPosition) {
                    return {
                        contractId: userPosition.contractId,
                        payload: {
                            positionId: userPosition.contractId,
                            userId,
                            marketId,
                            side: side as "yes" | "no",
                            quantity: userPosition.payload.quantity as unknown as import("decimal.js").default,
                            lockedQuantity: userPosition.payload
                                .lockedQuantity as unknown as import("decimal.js").default,
                            avgCostBasis: userPosition.payload.avgCostBasis as unknown as import("decimal.js").default,
                            lastUpdated: new Date(),
                            isArchived: false,
                        },
                    };
                }
            } catch {
                // Ignore query errors - position may not exist
            }
        }

        return null;
    }

    // ============================================
    // Position & Balance Updates
    // ============================================

    /**
     * Update positions and balances in database after a trade is settled.
     * This keeps the local database in sync with Canton ledger state.
     */
    private updatePositionsAndBalances(trade: Trade): void {
        const { buyerId, sellerId, marketId, side, quantity, price, tradeType } = trade;
        const cost = quantity.mul(price);

        this.log(
            `Updating positions for trade ${trade.tradeId}: ${buyerId.slice(0, 20)}... buys ${quantity} ${side.toUpperCase()} @ ${price} from ${sellerId.slice(0, 20)}...`,
        );

        // Update buyer's position (they receive shares)
        this.updateBuyerPosition(buyerId, marketId, side, quantity, price, tradeType);

        // Update seller's position (they give up shares or receive opposite side in share_creation)
        this.updateSellerPosition(sellerId, marketId, side, quantity, price, tradeType);

        // Update balances
        // Buyer: locked funds are debited (already locked, now spent)
        this.accountRepo.debitLocked(buyerId, cost);

        // Seller: receives payment to available balance
        if (tradeType === "share_trade") {
            // In share trade, seller gets paid
            this.accountRepo.creditAvailable(sellerId, cost);
        }
        // In share_creation, seller is actually buying NO side, so they also spend funds
        // (both buyer and seller are "buyers" of opposite sides)
        if (tradeType === "share_creation") {
            const sellerCost = quantity.mul(new Decimal(1).minus(price)); // NO price = 1 - YES price
            this.accountRepo.debitLocked(sellerId, sellerCost);
        }
    }

    /**
     * Update buyer's position after settlement
     */
    private updateBuyerPosition(
        buyerId: string,
        marketId: string,
        side: "yes" | "no",
        quantity: Decimal,
        price: Decimal,
        tradeType: "share_trade" | "share_creation",
    ): void {
        // In share_creation, buyer gets YES side; in share_trade, buyer gets the traded side
        const positionSide = tradeType === "share_creation" ? "yes" : side;

        const existingPosition = this.positionRepo.getByUserMarketSide(buyerId, marketId, positionSide);

        if (existingPosition) {
            // Add to existing position with weighted average cost
            this.positionRepo.addToPosition(existingPosition.positionId, quantity, price);
            this.log(
                `Updated buyer position ${existingPosition.positionId}: +${quantity} ${positionSide.toUpperCase()}`,
            );
        } else {
            // Create new position
            const positionId = `pos-${buyerId.slice(0, 20)}-${marketId}-${positionSide}-${Date.now()}`;
            this.positionRepo.create({
                positionId,
                userId: buyerId,
                marketId,
                side: positionSide,
                quantity,
                lockedQuantity: new Decimal(0),
                avgCostBasis: price,
                isArchived: false,
                lastUpdated: new Date(),
            });
            this.log(`Created buyer position ${positionId}: ${quantity} ${positionSide.toUpperCase()} @ ${price}`);
        }
    }

    /**
     * Update seller's position after settlement
     */
    private updateSellerPosition(
        sellerId: string,
        marketId: string,
        side: "yes" | "no",
        quantity: Decimal,
        price: Decimal,
        tradeType: "share_trade" | "share_creation",
    ): void {
        if (tradeType === "share_trade") {
            // Seller is selling existing shares - reduce their position
            const existingPosition = this.positionRepo.getByUserMarketSide(sellerId, marketId, side);
            if (existingPosition) {
                this.positionRepo.reducePosition(existingPosition.positionId, quantity);
                this.log(`Reduced seller position ${existingPosition.positionId}: -${quantity} ${side.toUpperCase()}`);
            }
        } else {
            // share_creation: seller gets NO side (they're buying the opposite side)
            const positionSide = "no";
            const noPrice = new Decimal(1).minus(price); // NO price = 1 - YES price

            const existingPosition = this.positionRepo.getByUserMarketSide(sellerId, marketId, positionSide);

            if (existingPosition) {
                this.positionRepo.addToPosition(existingPosition.positionId, quantity, noPrice);
                this.log(
                    `Updated seller position ${existingPosition.positionId}: +${quantity} ${positionSide.toUpperCase()}`,
                );
            } else {
                const positionId = `pos-${sellerId.slice(0, 20)}-${marketId}-${positionSide}-${Date.now()}`;
                this.positionRepo.create({
                    positionId,
                    userId: sellerId,
                    marketId,
                    side: positionSide,
                    quantity,
                    lockedQuantity: new Decimal(0),
                    avgCostBasis: noPrice,
                    isArchived: false,
                    lastUpdated: new Date(),
                });
                this.log(
                    `Created seller position ${positionId}: ${quantity} ${positionSide.toUpperCase()} @ ${noPrice}`,
                );
            }
        }
    }

    // ============================================
    // Error Handling & Recovery
    // ============================================

    /**
     * Handle batch processing failure
     */
    private async handleBatchFailure(batchId: string, batch: Trade[], error: unknown): Promise<void> {
        const currentBatch = this.settlementRepo.getBatchById(batchId);

        if (currentBatch && currentBatch.retryCount < this.maxRetries) {
            // Retry with exponential backoff
            this.settlementRepo.incrementBatchRetry(batchId, String(error));
            this.settlementRepo.updateBatchStatus(batchId, "pending");

            const delay = Math.min(1000 * Math.pow(2, currentBatch.retryCount), 30000);
            this.log(
                `Batch ${batchId} failed, retrying in ${delay}ms (attempt ${currentBatch.retryCount + 1}/${this.maxRetries})`,
            );

            await this.sleep(delay);

            // Re-queue trades for next batch
            this.pendingTrades.unshift(...batch);
        } else {
            // Max retries exceeded - mark as failed
            this.settlementRepo.updateBatchStatus(batchId, "failed", String(error));

            for (const trade of batch) {
                this.tradeRepo.updateSettlementStatus(trade.tradeId, "failed", batchId);
            }

            this.batchesFailed++;
            this.logError(`Batch ${batchId} failed permanently after ${this.maxRetries} retries`, error);
        }
    }

    /**
     * Recover pending batches from previous run
     */
    private recoverPendingBatches(): void {
        // Get incomplete batches
        const incompleteBatches = this.settlementRepo.getBatchesByStatus([
            "pending",
            "proposing",
            "accepting",
            "executing",
        ]);

        if (incompleteBatches.length === 0) {
            return;
        }

        this.log(`Recovering ${incompleteBatches.length} incomplete batches`);

        for (const batch of incompleteBatches) {
            if (batch.status === "pending") {
                // Re-queue trades
                const trades = batch.tradeIds
                    .map((id) => this.tradeRepo.getById(id))
                    .filter((t): t is Trade => t !== null);
                this.pendingTrades.push(...trades);
                this.log(`Re-queued ${trades.length} trades from batch ${batch.batchId}`);
            } else {
                // For batches in intermediate states, mark as failed for manual review
                // (proposals may have expired or be in inconsistent state)
                this.log(`Batch ${batch.batchId} was in state '${batch.status}' - marking as failed for review`);
                this.settlementRepo.updateBatchStatus(
                    batch.batchId,
                    "failed",
                    `Incomplete batch recovered in state '${batch.status}'`,
                );

                // Mark trades as failed
                for (const tradeId of batch.tradeIds) {
                    this.tradeRepo.updateSettlementStatus(tradeId, "failed", batch.batchId);
                }
            }
        }
    }

    // ============================================
    // Utility Methods
    // ============================================

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private generateBatchId(): string {
        return `batch-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    }

    private generateProposalId(batchId: string, tradeId: string): string {
        return `${batchId}-${tradeId}`;
    }

    private log(message: string, context?: Record<string, unknown>): void {
        if (context) {
            console.log(`[SettlementService] ${message}`, context);
        } else {
            console.log(`[SettlementService] ${message}`);
        }
    }

    private logError(message: string, error: unknown, context?: Record<string, unknown>): void {
        console.error(`[SettlementService] ERROR: ${message}`, error, context);
    }

    // ============================================
    // WebSocket Broadcasts
    // ============================================

    /**
     * Broadcast settlement completion events via WebSocket
     */
    private broadcastSettlementComplete(trades: Trade[], batchId: string): void {
        // Collect unique users and markets for targeted broadcasts
        const userIds = new Set<string>();
        const marketIds = new Set<string>();

        for (const trade of trades) {
            userIds.add(trade.buyerId);
            userIds.add(trade.sellerId);
            marketIds.add(trade.marketId);
        }

        // Notify each affected user about settlement completion
        for (const userId of userIds) {
            // Get user's trades in this batch
            const userTrades = trades.filter((t) => t.buyerId === userId || t.sellerId === userId);

            for (const trade of userTrades) {
                const isBuyer = trade.buyerId === userId;

                // Notify about balance changes
                wsManager.sendToUser(userId, "balance", "balance:updated", {
                    reason: "settlement",
                    tradeId: trade.tradeId,
                    side: isBuyer ? "buy" : "sell",
                    amount: trade.quantity.mul(trade.price).toString(),
                });
                logWsUserMessage(userId, "balance", "balance:updated", { tradeId: trade.tradeId });

                // Notify about position changes
                wsManager.sendToUser(userId, "positions", "position:updated", {
                    reason: "settlement",
                    tradeId: trade.tradeId,
                    marketId: trade.marketId,
                    side: trade.side,
                    quantity: trade.quantity.toString(),
                    action: isBuyer ? "acquired" : "sold",
                });
                logWsUserMessage(userId, "positions", "position:updated", { tradeId: trade.tradeId });
            }
        }

        // Broadcast settlement events to market trade channels
        for (const marketId of marketIds) {
            const marketTrades = trades.filter((t) => t.marketId === marketId);
            const tradesChannel = `trades:${marketId}` as const;

            for (const trade of marketTrades) {
                wsManager.broadcast(tradesChannel, "trade:settled", {
                    tradeId: trade.tradeId,
                    marketId: trade.marketId,
                    batchId,
                    price: trade.price.toString(),
                    quantity: trade.quantity.toString(),
                });
                logWsBroadcast(tradesChannel, "trade:settled", { tradeId: trade.tradeId, batchId });
            }
        }
    }
}
