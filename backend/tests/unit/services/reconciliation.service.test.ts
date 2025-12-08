/**
 * Unit tests for ReconciliationService
 *
 * Tests:
 * - Balance drift detection
 * - Drift correction
 * - Status tracking
 * - Service lifecycle (start/stop)
 */

import { describe, it, expect, beforeEach, mock, afterEach } from "bun:test";
import Decimal from "decimal.js";
import { ReconciliationService, DEFAULT_RECONCILIATION_CONFIG } from "../../../src/services/reconciliation.service";

// ============================================
// Mock Database
// ============================================

function createMockDb() {
    const rows: Array<Record<string, unknown>> = [];

    return {
        run: mock((..._args: unknown[]) => {
            // Store for verification
        }),
        prepare: mock(() => ({
            all: () => rows,
            get: () => rows[0] ?? null,
        })),
        _rows: rows,
    };
}

// ============================================
// Mock Canton Client
// ============================================

function createMockCantonClient(onChainBalances: Map<string, { available: string; locked: string }>) {
    return {
        getActiveContracts: mock(async <T>(_filter: { templateId: string; party: string }) => {
            const contracts: Array<{
                contractId: string;
                payload: T;
            }> = [];

            for (const [userId, balance] of onChainBalances) {
                contracts.push({
                    contractId: `cid-${userId}`,
                    payload: {
                        owner: userId,
                        pebbleAdmin: "PebbleAdmin",
                        availableBalance: balance.available,
                        lockedBalance: balance.locked,
                    } as T,
                });
            }

            return contracts;
        }),
    };
}

// ============================================
// Mock Balance Projection Service
// ============================================

function createMockBalanceProjection() {
    const accounts = new Map<
        string,
        {
            userId: string;
            partyId: string;
            availableBalance: Decimal;
            lockedBalance: Decimal;
            lastUpdated: Date;
        }
    >();

    return {
        getByUserId: mock((userId: string) => accounts.get(userId) ?? null),
        getStaleAccounts: mock((staleThresholdMinutes: number) => {
            const threshold = Date.now() - staleThresholdMinutes * 60 * 1000;
            return Array.from(accounts.values()).filter((a) => a.lastUpdated.getTime() < threshold);
        }),
        updateBalances: mock((userId: string, available: Decimal, locked: Decimal) => {
            const account = accounts.get(userId);
            if (account) {
                account.availableBalance = available;
                account.lockedBalance = locked;
                account.lastUpdated = new Date();
            }
        }),
        // Test helpers
        _set: (userId: string, available: number, locked: number, staleMinutes?: number) => {
            accounts.set(userId, {
                userId,
                partyId: userId,
                availableBalance: new Decimal(available),
                lockedBalance: new Decimal(locked),
                lastUpdated: new Date(Date.now() - (staleMinutes ?? 0) * 60 * 1000),
            });
        },
        _accounts: accounts,
    };
}

// ============================================
// Tests
// ============================================

describe("ReconciliationService", () => {
    let reconciliationService: ReconciliationService;
    let db: ReturnType<typeof createMockDb>;
    let balanceProjection: ReturnType<typeof createMockBalanceProjection>;
    let cantonClient: ReturnType<typeof createMockCantonClient>;
    let onChainBalances: Map<string, { available: string; locked: string }>;

    const config = {
        ...DEFAULT_RECONCILIATION_CONFIG,
        intervalMs: 50, // Short for tests
        pebbleAdminParty: "PebbleAdmin",
    };

    beforeEach(() => {
        db = createMockDb();
        balanceProjection = createMockBalanceProjection();
        onChainBalances = new Map();
        cantonClient = createMockCantonClient(onChainBalances);

        reconciliationService = new ReconciliationService(
            cantonClient as never,
            db as never,
            balanceProjection as never,
            config,
        );
    });

    afterEach(() => {
        reconciliationService.stop();
    });

    describe("getStatus", () => {
        it("should return initial status", () => {
            const status = reconciliationService.getStatus();

            expect(status.isRunning).toBe(false);
            expect(status.lastRunTime).toBeNull();
            expect(status.accountsReconciled).toBe(0);
            expect(status.driftsDetected).toBe(0);
            expect(status.driftsCorrected).toBe(0);
            expect(status.errors).toBe(0);
        });
    });

    describe("start/stop lifecycle", () => {
        it("should start the service", () => {
            reconciliationService.start();

            const status = reconciliationService.getStatus();
            expect(status.isRunning).toBe(true);
        });

        it("should not start twice", () => {
            reconciliationService.start();
            reconciliationService.start(); // Should warn but not throw

            const status = reconciliationService.getStatus();
            expect(status.isRunning).toBe(true);
        });

        it("should stop the service", () => {
            reconciliationService.start();
            reconciliationService.stop();

            const status = reconciliationService.getStatus();
            expect(status.isRunning).toBe(false);
        });
    });

    describe("reconcileAccount", () => {
        it("should return false for non-existent account", async () => {
            const result = await reconciliationService.reconcileAccount("unknown");

            expect(result).toBe(false);
        });

        it("should return false when no on-chain balance found", async () => {
            // Set up off-chain account but no on-chain
            balanceProjection._set("Alice", 1000, 0);

            const result = await reconciliationService.reconcileAccount("Alice");

            expect(result).toBe(false);
        });

        it("should return false when balances match (no drift)", async () => {
            // Set up matching balances
            balanceProjection._set("Alice", 1000, 100);
            onChainBalances.set("Alice", { available: "1000", locked: "100" });

            const result = await reconciliationService.reconcileAccount("Alice");

            expect(result).toBe(false); // No drift to correct
        });

        it("should detect and correct drift", async () => {
            // Set up drifted balances (off-chain is stale)
            balanceProjection._set("Alice", 900, 50); // Off-chain
            onChainBalances.set("Alice", { available: "1000", locked: "100" }); // On-chain (authoritative)

            const result = await reconciliationService.reconcileAccount("Alice");

            expect(result).toBe(true); // Drift detected and corrected

            // Balance should be updated to on-chain values
            expect(balanceProjection.updateBalances).toHaveBeenCalledWith("Alice", new Decimal(1000), new Decimal(100));
        });

        it("should not correct minor drift within tolerance", async () => {
            // Set up very small drift (0.001 = 0.1% tolerance by default)
            // Total on-chain = 1000.5, drift = 0.5 = 0.05% < 0.1%
            balanceProjection._set("Alice", 1000, 0);
            onChainBalances.set("Alice", { available: "1000.5", locked: "0" });

            const result = await reconciliationService.reconcileAccount("Alice");

            expect(result).toBe(false); // Drift within tolerance
        });
    });

    describe("automatic reconciliation", () => {
        it("should process stale accounts when running", async () => {
            // Set up a stale account (older than threshold)
            balanceProjection._set("Alice", 900, 50, 10); // 10 minutes old
            onChainBalances.set("Alice", { available: "1000", locked: "100" });

            // Make getStaleAccounts return our stale account
            balanceProjection.getStaleAccounts.mockReturnValue([balanceProjection._accounts.get("Alice")!]);

            reconciliationService.start();

            // Wait for reconciliation cycle
            await new Promise((resolve) => setTimeout(resolve, 100));

            const status = reconciliationService.getStatus();
            expect(status.accountsReconciled).toBeGreaterThan(0);
        });

        it("should update lastRunTime after cycle", async () => {
            reconciliationService.start();

            // Wait for reconciliation cycle
            await new Promise((resolve) => setTimeout(resolve, 100));

            const status = reconciliationService.getStatus();
            expect(status.lastRunTime).not.toBeNull();
        });
    });

    describe("error handling", () => {
        it("should return false when on-chain fetch fails", async () => {
            // Set up account
            balanceProjection._set("Alice", 1000, 0);

            // Make Canton client throw error
            cantonClient.getActiveContracts.mockRejectedValue(new Error("Network error"));

            const result = await reconciliationService.reconcileAccount("Alice");

            // fetchOnChainBalance catches the error and returns null
            // So reconcileAccount returns false for "no on-chain balance found"
            expect(result).toBe(false);
        });
    });

    describe("reconciliation history", () => {
        it("should record reconciliation events in database", async () => {
            // Set up drifted balances
            balanceProjection._set("Alice", 900, 50);
            onChainBalances.set("Alice", { available: "1000", locked: "100" });

            await reconciliationService.reconcileAccount("Alice");

            // Should have recorded to database
            expect(db.run).toHaveBeenCalled();
        });
    });

    describe("without Canton client", () => {
        it("should not start without Canton client", () => {
            const serviceWithoutCanton = new ReconciliationService(
                null,
                db as never,
                balanceProjection as never,
                config,
            );

            serviceWithoutCanton.start();

            const status = serviceWithoutCanton.getStatus();
            expect(status.isRunning).toBe(false);
        });

        it("should return false for reconcileAccount without Canton", async () => {
            const serviceWithoutCanton = new ReconciliationService(
                null,
                db as never,
                balanceProjection as never,
                config,
            );

            balanceProjection._set("Alice", 1000, 0);

            const result = await serviceWithoutCanton.reconcileAccount("Alice");

            expect(result).toBe(false);
        });
    });
});

describe("ReconciliationService drift calculations", () => {
    it("should calculate relative drift correctly", async () => {
        const db = createMockDb();
        const balanceProjection = createMockBalanceProjection();
        const onChainBalances = new Map<string, { available: string; locked: string }>();
        const cantonClient = createMockCantonClient(onChainBalances);

        const service = new ReconciliationService(cantonClient as never, db as never, balanceProjection as never, {
            intervalMs: 1000,
            staleThresholdMinutes: 5,
            driftTolerancePercentage: 0.01, // 1%
            pebbleAdminParty: "PebbleAdmin",
        });

        // 5% drift - should be detected
        // Total on-chain = 1050, drift = 50, relative = 50/1050 ≈ 4.76%
        balanceProjection._set("Alice", 1000, 0);
        onChainBalances.set("Alice", { available: "1050", locked: "0" });

        const result = await service.reconcileAccount("Alice");

        expect(result).toBe(true); // Drift > 1% tolerance
    });

    it("should handle zero balance edge case", async () => {
        const db = createMockDb();
        const balanceProjection = createMockBalanceProjection();
        const onChainBalances = new Map<string, { available: string; locked: string }>();
        const cantonClient = createMockCantonClient(onChainBalances);

        const service = new ReconciliationService(cantonClient as never, db as never, balanceProjection as never, {
            intervalMs: 1000,
            staleThresholdMinutes: 5,
            driftTolerancePercentage: 0.001,
            pebbleAdminParty: "PebbleAdmin",
        });

        // Zero balances should not cause division by zero
        balanceProjection._set("Alice", 0, 0);
        onChainBalances.set("Alice", { available: "0", locked: "0" });

        const result = await service.reconcileAccount("Alice");

        // Should complete without error
        expect(result).toBe(false);
    });
});
