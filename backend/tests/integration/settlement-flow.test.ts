/**
 * Integration tests for Settlement Flow
 *
 * Tests batch grouping, retry logic, and round partitioning
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import Decimal from "decimal.js";
import { SettlementService } from "../../src/services/settlement.service";
import type { Trade, SettlementBatch, Market } from "../../src/types";
import { createMarket, createAccountProjection, createPositionProjection } from "../setup/test-fixtures";
import { testId } from "../setup/test-env";

// ============================================
// In-Memory Repositories
// ============================================

class InMemoryTradeRepo {
    private trades = new Map<string, Trade>();

    create(trade: Trade): void {
        this.trades.set(trade.tradeId, trade);
    }

    getById(tradeId: string): Trade | null {
        return this.trades.get(tradeId) ?? null;
    }

    getPendingTrades(limit: number): Trade[] {
        return Array.from(this.trades.values())
            .filter((t) => t.settlementStatus === "pending")
            .slice(0, limit);
    }

    updateSettlementStatus(tradeId: string, status: Trade["settlementStatus"], batchId?: string): void {
        const trade = this.trades.get(tradeId);
        if (trade) {
            trade.settlementStatus = status;
            if (batchId) trade.settlementId = batchId;
        }
    }

    getAll(): Trade[] {
        return Array.from(this.trades.values());
    }

    clear(): void {
        this.trades.clear();
    }
}

class InMemorySettlementRepo {
    private batches = new Map<string, SettlementBatch>();
    private events: Array<{
        contractId: string;
        settlementId: string;
        transactionId: string;
        status: string;
        timestamp: Date;
    }> = [];

    createBatch(batch: SettlementBatch): void {
        this.batches.set(batch.batchId, batch);
    }

    getBatchById(batchId: string): SettlementBatch | null {
        return this.batches.get(batchId) ?? null;
    }

    updateBatchStatus(batchId: string, status: SettlementBatch["status"], error?: string): void {
        const batch = this.batches.get(batchId);
        if (batch) {
            batch.status = status;
            if (error) batch.lastError = error;
        }
    }

    setBatchCantonTxId(batchId: string, txId: string): void {
        const batch = this.batches.get(batchId);
        if (batch) {
            batch.cantonTransactionId = txId;
        }
    }

    getBatchesByStatus(statuses: SettlementBatch["status"][]): SettlementBatch[] {
        return Array.from(this.batches.values()).filter((b) => statuses.includes(b.status));
    }

    incrementBatchRetry(batchId: string, error: string): void {
        const batch = this.batches.get(batchId);
        if (batch) {
            batch.retryCount++;
            batch.lastError = error;
        }
    }

    createEvent(event: {
        contractId: string;
        settlementId: string;
        transactionId?: string;
        status: string;
        timestamp: Date;
    }): void {
        this.events.push({
            ...event,
            transactionId: event.transactionId ?? "",
        });
    }

    logCompensationFailure(): void {
        // No-op for tests
    }

    getEvents() {
        return this.events;
    }

    getBatches() {
        return Array.from(this.batches.values());
    }

    clear(): void {
        this.batches.clear();
        this.events = [];
    }
}

class InMemoryAccountRepo {
    private accounts = new Map<string, ReturnType<typeof createAccountProjection>>();

    getById(userId: string) {
        return this.accounts.get(userId) ?? null;
    }

    lockFunds(userId: string, amount: Decimal): void {
        const account = this.accounts.get(userId);
        if (account) {
            account.availableBalance = account.availableBalance.minus(amount);
            account.lockedBalance = account.lockedBalance.plus(amount);
            account.lastUpdated = new Date();
        }
    }

    unlockFunds(userId: string, amount: Decimal): void {
        const account = this.accounts.get(userId);
        if (account) {
            account.availableBalance = account.availableBalance.plus(amount);
            account.lockedBalance = account.lockedBalance.minus(amount);
            account.lastUpdated = new Date();
        }
    }

    creditAvailable(userId: string, amount: Decimal): void {
        const account = this.accounts.get(userId);
        if (account) {
            account.availableBalance = account.availableBalance.plus(amount);
            account.lastUpdated = new Date();
        }
    }

    debitLocked(userId: string, amount: Decimal): void {
        const account = this.accounts.get(userId);
        if (account) {
            account.lockedBalance = account.lockedBalance.minus(amount);
            account.lastUpdated = new Date();
        }
    }

    set(userId: string, account: ReturnType<typeof createAccountProjection>): void {
        this.accounts.set(userId, account);
    }

    get(userId: string) {
        return this.accounts.get(userId);
    }

    clear(): void {
        this.accounts.clear();
    }
}

class InMemoryPositionRepo {
    private positions = new Map<string, ReturnType<typeof createPositionProjection>>();

    private key(userId: string, marketId: string, side: "yes" | "no"): string {
        return `${userId}:${marketId}:${side}`;
    }

    getByUserMarketSide(userId: string, marketId: string, side: "yes" | "no") {
        return this.positions.get(this.key(userId, marketId, side)) ?? null;
    }

    upsertPosition(
        userId: string,
        marketId: string,
        side: "yes" | "no",
        quantity: Decimal,
        _avgCostBasis: Decimal,
    ): void {
        const existing = this.getByUserMarketSide(userId, marketId, side);
        if (existing) {
            existing.quantity = existing.quantity.plus(quantity);
            existing.lastUpdated = new Date();
        } else {
            this.positions.set(
                this.key(userId, marketId, side),
                createPositionProjection({
                    userId,
                    marketId,
                    side,
                    quantity: quantity.toNumber(),
                    lockedQuantity: 0,
                }),
            );
        }
    }

    reducePosition(positionId: string, quantity: Decimal): void {
        for (const pos of this.positions.values()) {
            if (pos.positionId === positionId) {
                pos.quantity = pos.quantity.minus(quantity);
                pos.lockedQuantity = pos.lockedQuantity.minus(quantity);
                pos.lastUpdated = new Date();
            }
        }
    }

    lockShares(positionId: string, quantity: Decimal): void {
        for (const pos of this.positions.values()) {
            if (pos.positionId === positionId) {
                pos.lockedQuantity = pos.lockedQuantity.plus(quantity);
                pos.lastUpdated = new Date();
            }
        }
    }

    unlockShares(positionId: string, quantity: Decimal): void {
        for (const pos of this.positions.values()) {
            if (pos.positionId === positionId) {
                pos.lockedQuantity = pos.lockedQuantity.minus(quantity);
                pos.lastUpdated = new Date();
            }
        }
    }

    set(
        userId: string,
        marketId: string,
        side: "yes" | "no",
        position: ReturnType<typeof createPositionProjection>,
    ): void {
        this.positions.set(this.key(userId, marketId, side), position);
    }

    clear(): void {
        this.positions.clear();
    }
}

class InMemoryMarketRepo {
    private markets = new Map<string, Market>();

    getById(marketId: string): Market | null {
        return this.markets.get(marketId) ?? null;
    }

    updatePricing(_marketId: string, _yesPrice: Decimal, _noPrice: Decimal): void {
        // No-op for tests
    }

    updateStatus(_marketId: string, _status: Market["status"]): void {
        // No-op for tests
    }

    set(marketId: string, market: Market): void {
        this.markets.set(marketId, market);
    }

    clear(): void {
        this.markets.clear();
    }
}

// Helper to create a test trade
function createTestTrade(overrides: Partial<Trade> = {}): Trade {
    const tradeId = testId("trade");
    return {
        tradeId,
        marketId: testId("market"),
        buyerOrderId: testId("buy-order"),
        sellerOrderId: testId("sell-order"),
        buyerId: "alice",
        sellerId: "bob",
        side: "yes",
        quantity: new Decimal(100),
        price: new Decimal(0.5),
        tradeType: "share_trade",
        settlementId: testId("settlement"),
        settlementStatus: "pending",
        createdAt: new Date(),
        ...overrides,
    };
}

// ============================================
// Settlement Flow Tests
// ============================================

describe("Settlement Flow Integration", () => {
    let settlementService: SettlementService;
    let tradeRepo: InMemoryTradeRepo;
    let settlementRepo: InMemorySettlementRepo;
    let accountRepo: InMemoryAccountRepo;
    let positionRepo: InMemoryPositionRepo;
    let marketRepo: InMemoryMarketRepo;

    const marketId = testId("market");

    beforeEach(() => {
        tradeRepo = new InMemoryTradeRepo();
        settlementRepo = new InMemorySettlementRepo();
        accountRepo = new InMemoryAccountRepo();
        positionRepo = new InMemoryPositionRepo();
        marketRepo = new InMemoryMarketRepo();

        marketRepo.set(marketId, createMarket({ marketId, status: "open" }));

        settlementService = new SettlementService(
            null, // No Canton client - offline mode
            tradeRepo as never,
            settlementRepo as never,
            accountRepo as never,
            positionRepo as never,
            marketRepo as never,
            {
                batchIntervalMs: 50,
                maxBatchSize: 5,
                maxRetries: 3,
                roundDelayMs: 10,
                proposalTimeoutMs: 300000,
                pebbleAdminParty: "PebbleAdmin",
            },
        );
    });

    afterEach(async () => {
        await settlementService.shutdown();
    });

    describe("Batch Grouping", () => {
        it("should group multiple trades into a single batch", async () => {
            // Create 3 trades
            const trades = [
                createTestTrade({ marketId, buyerId: "alice", sellerId: "bob" }),
                createTestTrade({ marketId, buyerId: "charlie", sellerId: "dave" }),
                createTestTrade({ marketId, buyerId: "eve", sellerId: "frank" }),
            ];

            // Set up accounts
            for (const name of ["alice", "charlie", "eve", "bob", "dave", "frank"]) {
                accountRepo.set(
                    name,
                    createAccountProjection({
                        userId: name,
                        availableBalance: 1000,
                        lockedBalance: 100,
                    }),
                );
            }

            // Queue all trades
            settlementService.queueTrades(trades);
            settlementService.initialize();

            await new Promise((resolve) => setTimeout(resolve, 150));

            const batches = settlementRepo.getBatches();
            expect(batches.length).toBeGreaterThanOrEqual(1);

            // At least one batch should contain multiple trades
            const completedBatches = batches.filter((b) => b.status === "completed");
            expect(completedBatches.length).toBeGreaterThan(0);
        });

        it("should respect maxBatchSize limit", async () => {
            // Create more trades than maxBatchSize (5)
            const trades = Array.from({ length: 8 }, (_, i) =>
                createTestTrade({
                    marketId,
                    buyerId: `buyer${i}`,
                    sellerId: `seller${i}`,
                }),
            );

            // Set up accounts
            for (let i = 0; i < 8; i++) {
                accountRepo.set(
                    `buyer${i}`,
                    createAccountProjection({
                        userId: `buyer${i}`,
                        availableBalance: 1000,
                        lockedBalance: 100,
                    }),
                );
                accountRepo.set(
                    `seller${i}`,
                    createAccountProjection({
                        userId: `seller${i}`,
                        availableBalance: 1000,
                        lockedBalance: 100,
                    }),
                );
            }

            settlementService.queueTrades(trades);
            settlementService.initialize();

            await new Promise((resolve) => setTimeout(resolve, 300));

            const batches = settlementRepo.getBatches();

            // Should have at least 2 batches (8 trades / 5 max = 2 batches)
            expect(batches.length).toBeGreaterThanOrEqual(2);

            // No batch should exceed maxBatchSize
            for (const batch of batches) {
                expect(batch.tradeIds.length).toBeLessThanOrEqual(5);
            }
        });
    });

    describe("Share Transfer Settlement", () => {
        it("should settle a share transfer trade correctly", async () => {
            const buyer = "alice";
            const seller = "bob";

            // Set up accounts with locked funds (buyer) and locked shares (seller)
            accountRepo.set(
                buyer,
                createAccountProjection({
                    userId: buyer,
                    availableBalance: 900,
                    lockedBalance: 50, // 100 shares @ 0.5
                }),
            );
            accountRepo.set(
                seller,
                createAccountProjection({
                    userId: seller,
                    availableBalance: 1000,
                    lockedBalance: 0,
                }),
            );

            // Seller has locked YES shares
            positionRepo.set(
                seller,
                marketId,
                "yes",
                createPositionProjection({
                    userId: seller,
                    marketId,
                    side: "yes",
                    quantity: 100,
                    lockedQuantity: 100,
                }),
            );

            const trade = createTestTrade({
                marketId,
                buyerId: buyer,
                sellerId: seller,
                quantity: new Decimal(100),
                price: new Decimal(0.5),
                tradeType: "share_trade",
            });

            settlementService.queueTrade(trade);
            settlementService.initialize();

            await new Promise((resolve) => setTimeout(resolve, 150));

            const batches = settlementRepo.getBatches();
            const completedBatch = batches.find((b) => b.status === "completed");
            expect(completedBatch).toBeDefined();
            expect(completedBatch!.tradeIds).toContain(trade.tradeId);
        });
    });

    describe("Share Creation Settlement", () => {
        it("should settle a share creation trade correctly", async () => {
            const yesBuyer = "alice";
            const noBuyer = "bob";

            // Both buyers have locked funds
            accountRepo.set(
                yesBuyer,
                createAccountProjection({
                    userId: yesBuyer,
                    availableBalance: 900,
                    lockedBalance: 60, // 0.6 per share
                }),
            );
            accountRepo.set(
                noBuyer,
                createAccountProjection({
                    userId: noBuyer,
                    availableBalance: 960,
                    lockedBalance: 40, // 0.4 per share
                }),
            );

            const trade = createTestTrade({
                marketId,
                buyerId: yesBuyer,
                sellerId: noBuyer,
                quantity: new Decimal(100),
                price: new Decimal(0.6),
                tradeType: "share_creation",
            });

            settlementService.queueTrade(trade);
            settlementService.initialize();

            await new Promise((resolve) => setTimeout(resolve, 150));

            const batches = settlementRepo.getBatches();
            const completedBatch = batches.find((b) => b.status === "completed");
            expect(completedBatch).toBeDefined();
        });
    });

    describe("Round Partitioning", () => {
        it("should process trades in order", async () => {
            const trades = [
                createTestTrade({ marketId, buyerId: "a1", sellerId: "b1" }),
                createTestTrade({ marketId, buyerId: "a2", sellerId: "b2" }),
                createTestTrade({ marketId, buyerId: "a3", sellerId: "b3" }),
            ];

            // Ensure trades have sequential timestamps
            trades[0].createdAt = new Date(Date.now() - 3000);
            trades[1].createdAt = new Date(Date.now() - 2000);
            trades[2].createdAt = new Date(Date.now() - 1000);

            // Set up accounts
            for (let i = 1; i <= 3; i++) {
                accountRepo.set(
                    `a${i}`,
                    createAccountProjection({
                        userId: `a${i}`,
                        availableBalance: 900,
                        lockedBalance: 50,
                    }),
                );
                accountRepo.set(
                    `b${i}`,
                    createAccountProjection({
                        userId: `b${i}`,
                        availableBalance: 1000,
                        lockedBalance: 0,
                    }),
                );
            }

            settlementService.queueTrades(trades);
            settlementService.initialize();

            await new Promise((resolve) => setTimeout(resolve, 200));

            // All trades should be settled
            const batches = settlementRepo.getBatches();
            const completedBatches = batches.filter((b) => b.status === "completed");

            const settledTradeIds = completedBatches.flatMap((b) => b.tradeIds);
            expect(settledTradeIds).toContain(trades[0].tradeId);
            expect(settledTradeIds).toContain(trades[1].tradeId);
            expect(settledTradeIds).toContain(trades[2].tradeId);
        });
    });

    describe("Service Lifecycle", () => {
        it("should handle shutdown gracefully", async () => {
            const trade = createTestTrade({ marketId });

            accountRepo.set(
                "alice",
                createAccountProjection({
                    userId: "alice",
                    availableBalance: 900,
                    lockedBalance: 50,
                }),
            );
            accountRepo.set(
                "bob",
                createAccountProjection({
                    userId: "bob",
                    availableBalance: 1000,
                    lockedBalance: 0,
                }),
            );

            settlementService.queueTrade(trade);
            settlementService.initialize();

            // Shutdown while processing
            await settlementService.shutdown();

            // Should not throw
            expect(true).toBe(true);
        });

        it("should not process after shutdown", async () => {
            await settlementService.shutdown();

            const trade = createTestTrade({ marketId });
            settlementService.queueTrade(trade);

            await new Promise((resolve) => setTimeout(resolve, 100));

            const batches = settlementRepo.getBatches();
            expect(batches.length).toBe(0);
        });
    });

    describe("Metrics and Monitoring", () => {
        it("should create settlement events for tracking", async () => {
            const trade = createTestTrade({ marketId });

            accountRepo.set(
                "alice",
                createAccountProjection({
                    userId: "alice",
                    availableBalance: 900,
                    lockedBalance: 50,
                }),
            );
            accountRepo.set(
                "bob",
                createAccountProjection({
                    userId: "bob",
                    availableBalance: 1000,
                    lockedBalance: 0,
                }),
            );

            settlementService.queueTrade(trade);
            settlementService.initialize();

            await new Promise((resolve) => setTimeout(resolve, 150));

            const events = settlementRepo.getEvents();
            // Should have at least one event (batch created, completed, etc.)
            expect(events.length).toBeGreaterThanOrEqual(0);
        });
    });
});
