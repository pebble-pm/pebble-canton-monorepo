/**
 * Reconciliation Service
 * Periodically reconciles off-chain cached balances with on-chain Canton state
 */

import type { Database as BunDatabase } from "bun:sqlite";
import Decimal from "decimal.js";
import type { CantonLedgerClient } from "../canton/client";
import { Templates } from "../canton/templates";
import type { BalanceProjectionService } from "../projections/balance.projection";

// ============================================
// Types
// ============================================

/** Reconciliation service configuration */
export interface ReconciliationConfig {
    /** How often to run reconciliation in ms (default: 60000 = 1 minute) */
    intervalMs: number;
    /** Accounts older than this are considered stale, in minutes (default: 5) */
    staleThresholdMinutes: number;
    /** Tolerance for balance drift before triggering correction (default: 0.001 = 0.1%) */
    driftTolerancePercentage: number;
    /** PebbleAdmin party for querying Canton contracts */
    pebbleAdminParty: string;
}

/** Default configuration values */
export const DEFAULT_RECONCILIATION_CONFIG: Omit<ReconciliationConfig, "pebbleAdminParty"> = {
    intervalMs: 60000,
    staleThresholdMinutes: 5,
    driftTolerancePercentage: 0.001,
};

/** Reconciliation service status for monitoring */
export interface ReconciliationStatus {
    /** Whether the service is running */
    isRunning: boolean;
    /** Time of last reconciliation run */
    lastRunTime: Date | null;
    /** Total accounts reconciled since startup */
    accountsReconciled: number;
    /** Total drifts detected since startup */
    driftsDetected: number;
    /** Total drifts corrected since startup */
    driftsCorrected: number;
    /** Total errors encountered */
    errors: number;
}

/** On-chain balance from TradingAccount contract */
interface OnChainBalance {
    availableBalance: string;
    lockedBalance: string;
}

/** Reconciliation history record */
interface ReconciliationRecord {
    userId: string;
    previousAvailable: Decimal;
    previousLocked: Decimal;
    onchainAvailable: Decimal;
    onchainLocked: Decimal;
    driftAvailable: Decimal;
    driftLocked: Decimal;
    reconciled: boolean;
    timestamp: Date;
}

// ============================================
// Service
// ============================================

/**
 * Periodically reconciles off-chain cached balances with on-chain state
 *
 * This service provides a safety net to ensure off-chain projections
 * stay in sync with Canton's authoritative on-chain state. It:
 *
 * 1. Identifies stale accounts (not updated recently)
 * 2. Fetches current on-chain balances from Canton
 * 3. Compares with off-chain cached values
 * 4. Corrects any drift that exceeds the tolerance threshold
 * 5. Records reconciliation events for audit
 *
 * Under normal operation with the LedgerEventProcessor running,
 * drift should be minimal or zero. This service provides defense
 * in depth against event processing failures or missed events.
 */
export class ReconciliationService {
    private isRunning = false;
    private timer: ReturnType<typeof setInterval> | null = null;
    private lastRunTime: Date | null = null;
    private accountsReconciled = 0;
    private driftsDetected = 0;
    private driftsCorrected = 0;
    private errors = 0;

    constructor(
        private readonly cantonClient: CantonLedgerClient | null,
        private readonly db: BunDatabase,
        private readonly balanceProjection: BalanceProjectionService,
        private readonly config: ReconciliationConfig,
    ) {}

    // ============================================
    // Public API
    // ============================================

    /**
     * Start the reconciliation loop
     */
    start(): void {
        if (this.isRunning) {
            console.warn("[Reconciliation] Already running");
            return;
        }

        if (!this.cantonClient) {
            console.warn("[Reconciliation] Canton client not available, skipping startup");
            return;
        }

        this.isRunning = true;
        console.log(
            `[Reconciliation] Starting (interval: ${this.config.intervalMs}ms, ` +
                `stale threshold: ${this.config.staleThresholdMinutes}min)`,
        );

        // Run immediately on startup, then on interval
        this.runReconciliation();
        this.timer = setInterval(() => {
            this.runReconciliation();
        }, this.config.intervalMs);
    }

    /**
     * Stop the reconciliation loop
     */
    stop(): void {
        console.log("[Reconciliation] Stopping...");
        this.isRunning = false;

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /**
     * Get current status for monitoring
     */
    getStatus(): ReconciliationStatus {
        return {
            isRunning: this.isRunning,
            lastRunTime: this.lastRunTime,
            accountsReconciled: this.accountsReconciled,
            driftsDetected: this.driftsDetected,
            driftsCorrected: this.driftsCorrected,
            errors: this.errors,
        };
    }

    /**
     * Manually trigger reconciliation for a specific account
     * Useful for admin debugging or forced sync
     *
     * @param userId - The user ID to reconcile
     * @returns true if reconciliation succeeded, false otherwise
     */
    async reconcileAccount(userId: string): Promise<boolean> {
        if (!this.cantonClient) return false;

        const account = this.balanceProjection.getByUserId(userId);
        if (!account) {
            console.warn(`[Reconciliation] Account not found: ${userId}`);
            return false;
        }

        try {
            const onChain = await this.fetchOnChainBalance(account.partyId);
            if (!onChain) {
                console.warn(`[Reconciliation] No on-chain balance found for ${userId}`);
                return false;
            }

            return await this.compareAndCorrect(
                userId,
                account.availableBalance,
                account.lockedBalance,
                new Decimal(onChain.availableBalance),
                new Decimal(onChain.lockedBalance),
            );
        } catch (error) {
            console.error(`[Reconciliation] Error reconciling ${userId}:`, error);
            this.errors++;
            return false;
        }
    }

    // ============================================
    // Reconciliation Logic
    // ============================================

    /**
     * Main reconciliation cycle
     * Called periodically by the timer
     */
    private async runReconciliation(): Promise<void> {
        if (!this.cantonClient) return;

        console.log("[Reconciliation] Running reconciliation cycle...");
        this.lastRunTime = new Date();

        try {
            // Get accounts that haven't been updated recently
            const staleAccounts = this.balanceProjection.getStaleAccounts(this.config.staleThresholdMinutes);

            if (staleAccounts.length === 0) {
                console.log("[Reconciliation] No stale accounts found");
                return;
            }

            console.log(`[Reconciliation] Found ${staleAccounts.length} stale accounts`);

            for (const account of staleAccounts) {
                try {
                    const onChain = await this.fetchOnChainBalance(account.partyId);
                    if (!onChain) {
                        console.warn(`[Reconciliation] No on-chain contract for ${account.userId.slice(0, 20)}...`);
                        continue;
                    }

                    const corrected = await this.compareAndCorrect(
                        account.userId,
                        account.availableBalance,
                        account.lockedBalance,
                        new Decimal(onChain.availableBalance),
                        new Decimal(onChain.lockedBalance),
                    );

                    this.accountsReconciled++;
                    if (corrected) {
                        this.driftsCorrected++;
                    }
                } catch (error) {
                    console.error(`[Reconciliation] Error processing ${account.userId.slice(0, 20)}...:`, error);
                    this.errors++;
                }
            }

            console.log(`[Reconciliation] Cycle complete: ${this.accountsReconciled} accounts checked`);
        } catch (error) {
            console.error("[Reconciliation] Cycle error:", error);
            this.errors++;
        }
    }

    /**
     * Fetch current on-chain balance for a party
     */
    private async fetchOnChainBalance(partyId: string): Promise<OnChainBalance | null> {
        if (!this.cantonClient) return null;

        try {
            // Query active TradingAccount contracts for this party
            const contracts = await this.cantonClient.getActiveContracts<{
                owner: string;
                pebbleAdmin: string;
                availableBalance: string;
                lockedBalance: string;
            }>({
                templateId: Templates.TradingAccount,
                party: this.config.pebbleAdminParty,
            });

            // Find the contract for this user
            const userContract = contracts.find((c) => c.payload.owner === partyId);
            if (!userContract) return null;

            return {
                availableBalance: String(userContract.payload.availableBalance),
                lockedBalance: String(userContract.payload.lockedBalance),
            };
        } catch (error) {
            console.error(`[Reconciliation] Failed to fetch on-chain balance for ${partyId.slice(0, 20)}...:`, error);
            return null;
        }
    }

    /**
     * Compare off-chain and on-chain balances, correct if needed
     *
     * @returns true if drift was detected and corrected, false otherwise
     */
    private async compareAndCorrect(
        userId: string,
        offChainAvailable: Decimal,
        offChainLocked: Decimal,
        onChainAvailable: Decimal,
        onChainLocked: Decimal,
    ): Promise<boolean> {
        // Calculate drift
        const driftAvailable = onChainAvailable.minus(offChainAvailable);
        const driftLocked = onChainLocked.minus(offChainLocked);

        // Calculate relative drift as percentage of total balance
        const totalOnChain = onChainAvailable.plus(onChainLocked);
        const totalDrift = driftAvailable.abs().plus(driftLocked.abs());

        // Avoid division by zero
        const relativeDrift = totalOnChain.isZero() ? new Decimal(0) : totalDrift.div(totalOnChain);

        const hasDrift = relativeDrift.gt(this.config.driftTolerancePercentage);

        if (hasDrift) {
            console.log(
                `[Reconciliation] Drift detected for ${userId.slice(0, 20)}...: ` +
                    `available=${driftAvailable.toFixed(4)}, locked=${driftLocked.toFixed(4)} ` +
                    `(${relativeDrift.mul(100).toFixed(2)}%)`,
            );
            this.driftsDetected++;

            // Correct by updating to on-chain values
            this.balanceProjection.updateBalances(userId, onChainAvailable, onChainLocked);

            // Record in reconciliation history
            this.recordReconciliation({
                userId,
                previousAvailable: offChainAvailable,
                previousLocked: offChainLocked,
                onchainAvailable: onChainAvailable,
                onchainLocked: onChainLocked,
                driftAvailable,
                driftLocked,
                reconciled: true,
                timestamp: new Date(),
            });

            console.log(
                `[Reconciliation] Corrected ${userId.slice(0, 20)}... to ` +
                    `available=${onChainAvailable.toFixed(4)}, locked=${onChainLocked.toFixed(4)}`,
            );

            return true;
        }

        // No significant drift, but still touch lastUpdated to mark as checked
        this.balanceProjection.updateBalances(userId, offChainAvailable, offChainLocked);

        return false;
    }

    /**
     * Record reconciliation event in history table
     */
    private recordReconciliation(record: ReconciliationRecord): void {
        try {
            this.db.run(
                `INSERT INTO reconciliation_history
         (user_id, previous_available, previous_locked,
          onchain_available, onchain_locked,
          drift_available, drift_locked, reconciled, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    record.userId,
                    record.previousAvailable.toNumber(),
                    record.previousLocked.toNumber(),
                    record.onchainAvailable.toNumber(),
                    record.onchainLocked.toNumber(),
                    record.driftAvailable.toNumber(),
                    record.driftLocked.toNumber(),
                    record.reconciled ? 1 : 0,
                    record.timestamp.toISOString(),
                ],
            );
        } catch (error) {
            console.error("[Reconciliation] Failed to record history:", error);
        }
    }
}
