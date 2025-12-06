/**
 * Load tests for settlement throughput
 *
 * Tests settlement service performance under high trade volume
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
    private batchCount = 0;

    createBatch(batch: SettlementBatch): void {
        this.batches.set(batch.batchId, batch);
        this.batchCount++;
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

    createEvent(event: { contractId: string; settlementId: string; transactionId?: string; status: string; timestamp: Date }): void {
        this.events.push({
            ...event,
            transactionId: event.transactionId ?? "",
        });
    }

    logCompensationFailure(): void {}

    getBatches() {
        return Array.from(this.batches.values());
    }

    getBatchCount() {
        return this.batchCount;
    }

    clear(): void {
        this.batches.clear();
        this.events = [];
        this.batchCount = 0;
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
        }
    }

    unlockFunds(userId: string, amount: Decimal): void {
        const account = this.accounts.get(userId);
        if (account) {
            account.availableBalance = account.availableBalance.plus(amount);
            account.lockedBalance = account.lockedBalance.minus(amount);
        }
    }

    creditAvailable(userId: string, amount: Decimal): void {
        const account = this.accounts.get(userId);
        if (account) {
            account.availableBalance = account.availableBalance.plus(amount);
        }
    }

    debitLocked(userId: string, amount: Decimal): void {
        const account = this.accounts.get(userId);
        if (account) {
            account.lockedBalance = account.lockedBalance.minus(amount);
        }
    }

    set(userId: string, account: ReturnType<typeof createAccountProjection>): void {
        this.accounts.set(userId, account);
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

    upsertPosition(userId: string, marketId: string, side: "yes" | "no", quantity: Decimal, _avgCostBasis: Decimal): void {
        const existing = this.getByUserMarketSide(userId, marketId, side);
        if (existing) {
            existing.quantity = existing.quantity.plus(quantity);
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
                pos.lockedQuantity = Decimal.max(pos.lockedQuantity.minus(quantity), new Decimal(0));
            }
        }
    }

    lockShares(positionId: string, quantity: Decimal): void {
        for (const pos of this.positions.values()) {
            if (pos.positionId === positionId) {
                pos.lockedQuantity = pos.lockedQuantity.plus(quantity);
            }
        }
    }

    unlockShares(positionId: string, quantity: Decimal): void {
        for (const pos of this.positions.values()) {
            if (pos.positionId === positionId) {
                pos.lockedQuantity = pos.lockedQuantity.minus(quantity);
            }
        }
    }

    set(userId: string, marketId: string, side: "yes" | "no", position: ReturnType<typeof createPositionProjection>): void {
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

    updatePricing(_marketId: string, _yesPrice: Decimal, _noPrice: Decimal): void {}
    updateStatus(_marketId: string, _status: Market["status"]): void {}

    set(marketId: string, market: Market): void {
        this.markets.set(marketId, market);
    }

    clear(): void {
        this.markets.clear();
    }
}

// Helper to create test trades
function createTestTrade(marketId: string, index: number): Trade {
    return {
        tradeId: testId(`trade-${index}`),
        marketId,
        buyerOrderId: testId(`buy-${index}`),
        sellerOrderId: testId(`sell-${index}`),
        buyerId: `buyer${index % 50}`,
        sellerId: `seller${index % 50}`,
        side: "yes",
        quantity: new Decimal(100),
        price: new Decimal(0.5),
        tradeType: "share_trade",
        settlementId: testId(`settlement-${index}`),
        settlementStatus: "pending",
        createdAt: new Date(),
    };
}

// ============================================
// Settlement Throughput Tests
// ============================================

describe("Settlement Throughput Load Tests", () => {
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

        // Set up many accounts
        for (let i = 0; i < 100; i++) {
            accountRepo.set(
                `buyer${i}`,
                createAccountProjection({
                    userId: `buyer${i}`,
                    availableBalance: 900,
                    lockedBalance: 100,
                }),
            );
            accountRepo.set(
                `seller${i}`,
                createAccountProjection({
                    userId: `seller${i}`,
                    availableBalance: 1000,
                    lockedBalance: 0,
                }),
            );
        }

        settlementService = new SettlementService(
            null,
            tradeRepo as never,
            settlementRepo as never,
            accountRepo as never,
            positionRepo as never,
            marketRepo as never,
            {
                batchIntervalMs: 25,
                maxBatchSize: 50,
                maxRetries: 3,
                roundDelayMs: 5,
                proposalTimeoutMs: 300000,
                pebbleAdminParty: "PebbleAdmin",
            },
        );
    });

    afterEach(async () => {
        await settlementService.shutdown();
    });

    describe("High Volume Settlement", () => {
        it("should settle 100 trades efficiently", async () => {
            // Create 100 trades
            const trades = Array.from({ length: 100 }, (_, i) => createTestTrade(marketId, i));

            const startTime = Date.now();

            // Queue all trades
            settlementService.queueTrades(trades);
            settlementService.initialize();

            // Wait for settlement
            await new Promise((resolve) => setTimeout(resolve, 500));

            const endTime = Date.now();

            // Verify all trades were batched
            const batches = settlementRepo.getBatches();
            const completedBatches = batches.filter((b) => b.status === "completed");

            const totalSettledTrades = completedBatches.reduce((sum, b) => sum + b.tradeIds.length, 0);

            expect(totalSettledTrades).toBe(100);

            const duration = endTime - startTime;
            console.log(`Settled 100 trades in ${duration}ms`);
            console.log(`Created ${batches.length} batches`);
            console.log(`Average batch size: ${100 / batches.length}`);
            console.log(`Throughput: ${(100 / duration) * 1000} trades/second`);

            expect(duration).toBeLessThan(2000);
        });

        it("should maintain batch efficiency under load", async () => {
            const trades = Array.from({ length: 200 }, (_, i) => createTestTrade(marketId, i));

            settlementService.queueTrades(trades);
            settlementService.initialize();

            await new Promise((resolve) => setTimeout(resolve, 1000));

            const batches = settlementRepo.getBatches();
            const completedBatches = batches.filter((b) => b.status === "completed");

            // Should have efficient batching (not 200 batches for 200 trades)
            expect(completedBatches.length).toBeLessThan(50);

            // Average batch size should be reasonable
            const totalSettled = completedBatches.reduce((sum, b) => sum + b.tradeIds.length, 0);
            const avgBatchSize = totalSettled / completedBatches.length;

            console.log(`Average batch size: ${avgBatchSize.toFixed(1)} trades`);
            expect(avgBatchSize).toBeGreaterThan(3);
        });
    });

    describe("Streaming Trade Ingestion", () => {
        it("should handle continuous trade stream", async () => {
            settlementService.initialize();

            const startTime = Date.now();
            let totalQueued = 0;

            // Stream trades over time (simulating continuous matching)
            for (let batch = 0; batch < 5; batch++) {
                const trades = Array.from({ length: 20 }, (_, i) => createTestTrade(marketId, batch * 20 + i));
                settlementService.queueTrades(trades);
                totalQueued += 20;

                // Small delay between batches
                await new Promise((resolve) => setTimeout(resolve, 50));
            }

            // Wait for all to settle
            await new Promise((resolve) => setTimeout(resolve, 500));

            const endTime = Date.now();

            const batches = settlementRepo.getBatches();
            const completedBatches = batches.filter((b) => b.status === "completed");
            const totalSettled = completedBatches.reduce((sum, b) => sum + b.tradeIds.length, 0);

            expect(totalSettled).toBe(100);

            const duration = endTime - startTime;
            console.log(`Streamed and settled ${totalSettled} trades in ${duration}ms`);
        });
    });

    describe("Multi-Market Settlement", () => {
        it("should handle trades from multiple markets", async () => {
            const markets = Array.from({ length: 5 }, (_, i) => testId(`market${i}`));

            for (const mkt of markets) {
                marketRepo.set(mkt, createMarket({ marketId: mkt, status: "open" }));
            }

            // Create trades across all markets
            const allTrades: Trade[] = [];
            for (let m = 0; m < markets.length; m++) {
                for (let i = 0; i < 20; i++) {
                    allTrades.push({
                        tradeId: testId(`m${m}-trade-${i}`),
                        marketId: markets[m],
                        buyerOrderId: testId(`m${m}-buy-${i}`),
                        sellerOrderId: testId(`m${m}-sell-${i}`),
                        buyerId: `buyer${i}`,
                        sellerId: `seller${i}`,
                        side: "yes",
                        quantity: new Decimal(100),
                        price: new Decimal(0.5),
                        tradeType: "share_trade",
                        settlementId: testId(`m${m}-settlement-${i}`),
                        settlementStatus: "pending",
                        createdAt: new Date(),
                    });
                }
            }

            const startTime = Date.now();

            settlementService.queueTrades(allTrades);
            settlementService.initialize();

            await new Promise((resolve) => setTimeout(resolve, 750));

            const endTime = Date.now();

            const batches = settlementRepo.getBatches();
            const completedBatches = batches.filter((b) => b.status === "completed");
            const totalSettled = completedBatches.reduce((sum, b) => sum + b.tradeIds.length, 0);

            expect(totalSettled).toBe(100);

            const duration = endTime - startTime;
            console.log(`Settled ${totalSettled} trades across ${markets.length} markets in ${duration}ms`);
        });
    });

    describe("Share Creation vs Transfer Mix", () => {
        it("should handle mixed trade types efficiently", async () => {
            const trades: Trade[] = [];

            // Mix of share trades and share creations
            for (let i = 0; i < 50; i++) {
                // Share trade
                trades.push({
                    tradeId: testId(`transfer-${i}`),
                    marketId,
                    buyerOrderId: testId(`buy-t-${i}`),
                    sellerOrderId: testId(`sell-t-${i}`),
                    buyerId: `buyer${i}`,
                    sellerId: `seller${i}`,
                    side: "yes",
                    quantity: new Decimal(100),
                    price: new Decimal(0.5),
                    tradeType: "share_trade",
                    settlementId: testId(`settlement-t-${i}`),
                    settlementStatus: "pending",
                    createdAt: new Date(),
                });

                // Share creation
                trades.push({
                    tradeId: testId(`creation-${i}`),
                    marketId,
                    buyerOrderId: testId(`yes-buy-${i}`),
                    sellerOrderId: testId(`no-buy-${i}`),
                    buyerId: `buyer${i}`,
                    sellerId: `seller${i}`,
                    side: "yes",
                    quantity: new Decimal(100),
                    price: new Decimal(0.6),
                    tradeType: "share_creation",
                    settlementId: testId(`settlement-c-${i}`),
                    settlementStatus: "pending",
                    createdAt: new Date(),
                });
            }

            const startTime = Date.now();

            settlementService.queueTrades(trades);
            settlementService.initialize();

            await new Promise((resolve) => setTimeout(resolve, 750));

            const endTime = Date.now();

            const batches = settlementRepo.getBatches();
            const completedBatches = batches.filter((b) => b.status === "completed");
            const totalSettled = completedBatches.reduce((sum, b) => sum + b.tradeIds.length, 0);

            expect(totalSettled).toBe(100);

            const duration = endTime - startTime;
            console.log(`Settled ${totalSettled} mixed trades in ${duration}ms`);
        });
    });

    describe("Backpressure Handling", () => {
        it("should handle burst of trades without overwhelming", async () => {
            // Simulate a large burst
            const trades = Array.from({ length: 500 }, (_, i) => createTestTrade(marketId, i));

            const startTime = Date.now();

            // Queue all at once
            settlementService.queueTrades(trades);
            settlementService.initialize();

            // Wait longer for large batch
            await new Promise((resolve) => setTimeout(resolve, 2000));

            const endTime = Date.now();

            const batches = settlementRepo.getBatches();
            const completedBatches = batches.filter((b) => b.status === "completed");
            const totalSettled = completedBatches.reduce((sum, b) => sum + b.tradeIds.length, 0);

            console.log(`Burst test: ${totalSettled}/${trades.length} trades settled`);
            console.log(`Batches created: ${batches.length}`);
            console.log(`Duration: ${endTime - startTime}ms`);

            // Should have made good progress
            expect(totalSettled).toBeGreaterThan(400);
        });
    });

    describe("Settlement Metrics", () => {
        it("should track settlement latency", async () => {
            const trades = Array.from({ length: 50 }, (_, i) => ({
                ...createTestTrade(marketId, i),
                createdAt: new Date(),
            }));

            settlementService.queueTrades(trades);
            settlementService.initialize();

            await new Promise((resolve) => setTimeout(resolve, 500));

            const batches = settlementRepo.getBatches();
            const completedBatches = batches.filter((b) => b.status === "completed");

            // Calculate latency (time from trade creation to batch completion)
            const latencies: number[] = [];
            const now = Date.now();

            for (const batch of completedBatches) {
                const batchCreatedAt = new Date(batch.createdAt).getTime();
                latencies.push(now - batchCreatedAt);
            }

            if (latencies.length > 0) {
                const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
                const maxLatency = Math.max(...latencies);
                const minLatency = Math.min(...latencies);

                console.log(`Settlement Latency Stats:`);
                console.log(`  Average: ${avgLatency.toFixed(0)}ms`);
                console.log(`  Min: ${minLatency}ms`);
                console.log(`  Max: ${maxLatency}ms`);
            }

            expect(completedBatches.length).toBeGreaterThan(0);
        });
    });
});
