/**
 * Integration tests for Order -> Matching -> Settlement flow
 *
 * These tests verify the complete trading flow without external dependencies.
 * The Canton client is mocked, but all other services interact together.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import Decimal from "decimal.js";
import { MatchingEngine, OrderbookPersistence } from "../../src/matching";
import { OrderService } from "../../src/services/order.service";
import { SettlementService } from "../../src/services/settlement.service";
import type { Order, Trade, Market, SettlementBatch } from "../../src/types";
import { createMarket, createAccountProjection, createPositionProjection } from "../setup/test-fixtures";

// ============================================
// In-Memory Repositories for Integration Tests
// ============================================

class InMemoryOrderRepo {
    private orders = new Map<string, Order>();

    create(order: Order): void {
        this.orders.set(order.orderId, order);
    }

    getById(orderId: string): Order | null {
        return this.orders.get(orderId) ?? null;
    }

    getByUser(userId: string): Order[] {
        return Array.from(this.orders.values()).filter((o) => o.userId === userId);
    }

    getOpenOrdersByUser(userId: string, marketId?: string): Order[] {
        return Array.from(this.orders.values()).filter(
            (o) =>
                o.userId === userId &&
                (o.status === "open" || o.status === "partial") &&
                (!marketId || o.marketId === marketId),
        );
    }

    getByIdempotencyKey(_userId: string, _key: string): Order | null {
        return null;
    }

    updateFilled(orderId: string, filledQuantity: Decimal, status: Order["status"]): void {
        const order = this.orders.get(orderId);
        if (order) {
            order.filledQuantity = filledQuantity;
            order.status = status;
            order.updatedAt = new Date();
        }
    }

    updateStatus(orderId: string, status: Order["status"]): void {
        const order = this.orders.get(orderId);
        if (order) {
            order.status = status;
            order.updatedAt = new Date();
        }
    }

    clear(): void {
        this.orders.clear();
    }
}

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

// Mock persistence that does nothing
class MockPersistence {
    rehydrateOrderbook(_engine: MatchingEngine): { restoredCount: number } {
        return { restoredCount: 0 };
    }
    persistOrder(_order: Order): void {}
    removeOrder(_orderId: string): void {}
}

// ============================================
// Integration Tests
// ============================================

describe("Order to Settlement Integration", () => {
    let orderService: OrderService;
    let settlementService: SettlementService;
    let matchingEngine: MatchingEngine;
    let orderRepo: InMemoryOrderRepo;
    let tradeRepo: InMemoryTradeRepo;
    let accountRepo: InMemoryAccountRepo;
    let positionRepo: InMemoryPositionRepo;
    let marketRepo: InMemoryMarketRepo;
    let settlementRepo: InMemorySettlementRepo;

    const marketId = "test-market-001";
    const alice = "Alice";
    const bob = "Bob";

    beforeEach(() => {
        // Create fresh instances
        matchingEngine = new MatchingEngine();
        orderRepo = new InMemoryOrderRepo();
        tradeRepo = new InMemoryTradeRepo();
        accountRepo = new InMemoryAccountRepo();
        positionRepo = new InMemoryPositionRepo();
        marketRepo = new InMemoryMarketRepo();
        settlementRepo = new InMemorySettlementRepo();

        const persistence = new MockPersistence() as unknown as OrderbookPersistence;

        // Set up test data
        marketRepo.set(marketId, createMarket({ marketId, status: "open" }));
        accountRepo.set(alice, createAccountProjection({ userId: alice, availableBalance: 10000 }));
        accountRepo.set(bob, createAccountProjection({ userId: bob, availableBalance: 10000 }));

        // Create OrderService (Canton offline mode)
        orderService = new OrderService(
            null,
            matchingEngine,
            persistence,
            orderRepo as never,
            tradeRepo as never,
            accountRepo as never,
            positionRepo as never,
            marketRepo as never,
            settlementRepo as never,
            { pebbleAdminParty: "PebbleAdmin" },
        );

        // Create SettlementService (Canton offline mode)
        settlementService = new SettlementService(
            null,
            tradeRepo as never,
            settlementRepo as never,
            accountRepo as never,
            positionRepo as never,
            marketRepo as never,
            {
                batchIntervalMs: 100,
                maxBatchSize: 10,
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

    describe("Share Trading Flow", () => {
        it("should complete a full share trade from order to settlement", async () => {
            // Step 1: Bob has YES shares to sell
            positionRepo.set(
                bob,
                marketId,
                "yes",
                createPositionProjection({
                    userId: bob,
                    marketId,
                    side: "yes",
                    quantity: 100,
                    lockedQuantity: 0,
                }),
            );

            // Step 2: Bob places a sell order
            const sellResult = await orderService.placeOrder(bob, {
                marketId,
                side: "yes",
                action: "sell",
                orderType: "limit",
                price: 0.6,
                quantity: 50,
            });

            expect(sellResult.status).toBe("open");
            expect(sellResult.trades).toHaveLength(0);

            // Step 3: Alice places a matching buy order
            const buyResult = await orderService.placeOrder(alice, {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.6,
                quantity: 50,
            });

            // Step 4: Verify matching occurred
            expect(buyResult.status).toBe("filled");
            expect(buyResult.trades).toHaveLength(1);
            expect(buyResult.trades[0].quantity.toNumber()).toBe(50);
            expect(buyResult.trades[0].price.toNumber()).toBe(0.6);

            // Step 5: Queue trade for settlement (use actual trade from repo)
            const trades = tradeRepo.getAll();
            expect(trades).toHaveLength(1);
            const trade = trades[0];
            settlementService.queueTrade(trade);

            // Step 6: Start settlement processing
            settlementService.initialize();

            // Wait for batch to process
            await new Promise((resolve) => setTimeout(resolve, 200));

            // Step 7: Verify settlement completed
            const batches = settlementRepo.getBatches();
            expect(batches.length).toBeGreaterThanOrEqual(1);

            const completedBatch = batches.find((b) => b.status === "completed");
            expect(completedBatch).toBeDefined();
            expect(completedBatch!.tradeIds).toContain(trade.tradeId);
        });
    });

    describe("Share Creation Flow (Cross-matching)", () => {
        it("should create shares when BUY YES and BUY NO orders cross-match", async () => {
            // Alice wants to buy YES @ 0.60 (will pay 0.60)
            // Bob wants to buy NO @ 0.40 (will pay 0.40)
            // Together they pay 1.00 for a YES+NO pair

            // Place buy YES order
            const yesResult = await orderService.placeOrder(alice, {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.6,
                quantity: 100,
            });

            expect(yesResult.status).toBe("open");

            // Place buy NO order that should cross-match
            const noResult = await orderService.placeOrder(bob, {
                marketId,
                side: "no",
                action: "buy",
                orderType: "limit",
                price: 0.4, // 0.4 + 0.6 = 1.0
                quantity: 100,
            });

            // Should have matched via share creation
            expect(noResult.status).toBe("filled");
            expect(noResult.trades).toHaveLength(1);
            expect(noResult.trades[0].quantity.toNumber()).toBe(100);

            // Get the actual trade from the repo to verify trade type
            const trades = tradeRepo.getAll();
            expect(trades).toHaveLength(1);
            expect(trades[0].tradeType).toBe("share_creation");

            // Queue and settle
            const trade = trades[0];
            settlementService.queueTrade(trade);
            settlementService.initialize();

            await new Promise((resolve) => setTimeout(resolve, 200));

            const batches = settlementRepo.getBatches();
            const completedBatch = batches.find((b) => b.status === "completed");
            expect(completedBatch).toBeDefined();
        });
    });

    describe("Partial Fill Flow", () => {
        it("should handle partial fills correctly", async () => {
            // Bob has only 30 shares to sell
            positionRepo.set(
                bob,
                marketId,
                "yes",
                createPositionProjection({
                    userId: bob,
                    marketId,
                    side: "yes",
                    quantity: 30,
                    lockedQuantity: 0,
                }),
            );

            // Bob places sell order for 30 shares
            await orderService.placeOrder(bob, {
                marketId,
                side: "yes",
                action: "sell",
                orderType: "limit",
                price: 0.5,
                quantity: 30,
            });

            // Alice wants to buy 50 shares
            const buyResult = await orderService.placeOrder(alice, {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.5,
                quantity: 50,
            });

            // Should be partially filled
            expect(buyResult.status).toBe("partial");
            expect(buyResult.filledQuantity.toNumber()).toBe(30);
            expect(buyResult.remainingQuantity.toNumber()).toBe(20);
            expect(buyResult.trades).toHaveLength(1);
            expect(buyResult.trades[0].quantity.toNumber()).toBe(30);

            // Verify Alice's order is still in the book for remaining 20
            const openOrders = orderService.getOpenOrdersByUser(alice);
            expect(openOrders).toHaveLength(1);
            expect(openOrders[0].quantity.minus(openOrders[0].filledQuantity).toNumber()).toBe(20);
        });
    });

    describe("Multiple Trades in One Batch", () => {
        it("should process multiple trades in a single settlement batch", async () => {
            // Set up positions for Bob and Charlie
            const charlie = "Charlie";
            accountRepo.set(charlie, createAccountProjection({ userId: charlie, availableBalance: 10000 }));
            positionRepo.set(
                bob,
                marketId,
                "yes",
                createPositionProjection({
                    userId: bob,
                    marketId,
                    side: "yes",
                    quantity: 100,
                    lockedQuantity: 0,
                }),
            );
            positionRepo.set(
                charlie,
                marketId,
                "yes",
                createPositionProjection({
                    userId: charlie,
                    marketId,
                    side: "yes",
                    quantity: 100,
                    lockedQuantity: 0,
                }),
            );

            // Bob sells to Alice
            await orderService.placeOrder(bob, {
                marketId,
                side: "yes",
                action: "sell",
                orderType: "limit",
                price: 0.5,
                quantity: 50,
            });

            await orderService.placeOrder(alice, {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.5,
                quantity: 50,
            });

            // Charlie sells to Alice
            await orderService.placeOrder(charlie, {
                marketId,
                side: "yes",
                action: "sell",
                orderType: "limit",
                price: 0.55,
                quantity: 50,
            });

            await orderService.placeOrder(alice, {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.55,
                quantity: 50,
            });

            // Get actual trades from trade repo (they have proper createdAt)
            const trades = tradeRepo.getAll();
            expect(trades).toHaveLength(2);

            // Queue both trades
            settlementService.queueTrades(trades);

            // Process
            settlementService.initialize();
            await new Promise((resolve) => setTimeout(resolve, 300));

            // Both trades should be in same or sequential batches
            const batches = settlementRepo.getBatches();
            const completedBatches = batches.filter((b) => b.status === "completed");

            // Should have at least one completed batch
            expect(completedBatches.length).toBeGreaterThanOrEqual(1);

            // Total trades settled should be 2
            const totalSettledTrades = completedBatches.reduce((sum, b) => sum + b.tradeIds.length, 0);
            expect(totalSettledTrades).toBe(2);
        });
    });

    describe("Order Cancellation", () => {
        it("should properly cancel unfilled orders", async () => {
            // Alice places a buy order
            const result = await orderService.placeOrder(alice, {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.3, // Low price - won't match
                quantity: 100,
            });

            expect(result.status).toBe("open");

            // Check Alice's locked funds
            const aliceAccount = accountRepo.get(alice)!;
            const lockedBefore = aliceAccount.lockedBalance.toNumber();
            expect(lockedBefore).toBeGreaterThan(0);

            // Cancel the order
            const cancelResult = await orderService.cancelOrder(alice, result.orderId);
            expect(cancelResult.status).toBe("cancelled");

            // Verify funds were unlocked
            const aliceAccountAfter = accountRepo.get(alice)!;
            expect(aliceAccountAfter.lockedBalance.toNumber()).toBe(0);
        });
    });

    describe("Balance Tracking", () => {
        it("should correctly track balances through trading", async () => {
            const initialAliceBalance = accountRepo.get(alice)!.availableBalance.toNumber();

            // Bob has YES shares
            positionRepo.set(
                bob,
                marketId,
                "yes",
                createPositionProjection({
                    userId: bob,
                    marketId,
                    side: "yes",
                    quantity: 100,
                    lockedQuantity: 0,
                }),
            );

            // Bob sells YES @ 0.70
            await orderService.placeOrder(bob, {
                marketId,
                side: "yes",
                action: "sell",
                orderType: "limit",
                price: 0.7,
                quantity: 100,
            });

            // Alice buys YES @ 0.70
            const buyResult = await orderService.placeOrder(alice, {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.7,
                quantity: 100,
            });

            expect(buyResult.status).toBe("filled");

            // Alice should have paid 70 (locked during order)
            const aliceAfterTrade = accountRepo.get(alice)!;
            // Funds were locked on order placement
            expect(initialAliceBalance - aliceAfterTrade.availableBalance.toNumber()).toBe(70);

            // Bob's shares were locked (position locking)
            // After trade, Bob would receive 70 (handled in settlement)
        });
    });
});

describe("Cross-Market Trading", () => {
    let orderService: OrderService;
    let settlementService: SettlementService;
    let matchingEngine: MatchingEngine;
    let orderRepo: InMemoryOrderRepo;
    let tradeRepo: InMemoryTradeRepo;
    let accountRepo: InMemoryAccountRepo;
    let positionRepo: InMemoryPositionRepo;
    let marketRepo: InMemoryMarketRepo;
    let settlementRepo: InMemorySettlementRepo;

    const market1 = "market-election";
    const market2 = "market-weather";
    const alice = "Alice";

    beforeEach(() => {
        matchingEngine = new MatchingEngine();
        orderRepo = new InMemoryOrderRepo();
        tradeRepo = new InMemoryTradeRepo();
        accountRepo = new InMemoryAccountRepo();
        positionRepo = new InMemoryPositionRepo();
        marketRepo = new InMemoryMarketRepo();
        settlementRepo = new InMemorySettlementRepo();

        const persistence = new MockPersistence() as unknown as OrderbookPersistence;

        // Set up two markets
        marketRepo.set(market1, createMarket({ marketId: market1, status: "open" }));
        marketRepo.set(market2, createMarket({ marketId: market2, status: "open" }));

        accountRepo.set(alice, createAccountProjection({ userId: alice, availableBalance: 10000 }));

        orderService = new OrderService(
            null,
            matchingEngine,
            persistence,
            orderRepo as never,
            tradeRepo as never,
            accountRepo as never,
            positionRepo as never,
            marketRepo as never,
            settlementRepo as never,
            { pebbleAdminParty: "PebbleAdmin" },
        );

        settlementService = new SettlementService(
            null,
            tradeRepo as never,
            settlementRepo as never,
            accountRepo as never,
            positionRepo as never,
            marketRepo as never,
            {
                batchIntervalMs: 100,
                maxBatchSize: 10,
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

    it("should keep orders isolated between markets", async () => {
        // Place order in market1
        await orderService.placeOrder(alice, {
            marketId: market1,
            side: "yes",
            action: "buy",
            orderType: "limit",
            price: 0.5,
            quantity: 100,
        });

        // Place order in market2
        await orderService.placeOrder(alice, {
            marketId: market2,
            side: "yes",
            action: "buy",
            orderType: "limit",
            price: 0.6,
            quantity: 50,
        });

        // Verify orders are in separate orderbooks
        const market1Orders = orderService.getOpenOrdersByUser(alice, market1);
        const market2Orders = orderService.getOpenOrdersByUser(alice, market2);

        expect(market1Orders).toHaveLength(1);
        expect(market1Orders[0].price.toNumber()).toBe(0.5);

        expect(market2Orders).toHaveLength(1);
        expect(market2Orders[0].price.toNumber()).toBe(0.6);
    });
});
