/**
 * Load tests for concurrent order processing
 *
 * Tests system behavior under concurrent order load
 */

import { describe, it, expect, beforeEach } from "bun:test";
import Decimal from "decimal.js";
import { MatchingEngine, OrderbookPersistence } from "../../src/matching";
import { OrderService } from "../../src/services/order.service";
import type { Order, Trade, Market, SettlementBatch } from "../../src/types";
import { createMarket, createAccountProjection, createPositionProjection } from "../setup/test-fixtures";
import { testId } from "../setup/test-env";

// ============================================
// In-Memory Repositories
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
            (o) => o.userId === userId && (o.status === "open" || o.status === "partial") && (!marketId || o.marketId === marketId),
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

    getAll(): Order[] {
        return Array.from(this.orders.values());
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
    private lockCount = 0;
    private unlockCount = 0;

    getById(userId: string) {
        return this.accounts.get(userId) ?? null;
    }

    lockFunds(userId: string, amount: Decimal): void {
        const account = this.accounts.get(userId);
        if (account) {
            account.availableBalance = account.availableBalance.minus(amount);
            account.lockedBalance = account.lockedBalance.plus(amount);
            account.lastUpdated = new Date();
            this.lockCount++;
        }
    }

    unlockFunds(userId: string, amount: Decimal): void {
        const account = this.accounts.get(userId);
        if (account) {
            account.availableBalance = account.availableBalance.plus(amount);
            account.lockedBalance = account.lockedBalance.minus(amount);
            account.lastUpdated = new Date();
            this.unlockCount++;
        }
    }

    set(userId: string, account: ReturnType<typeof createAccountProjection>): void {
        this.accounts.set(userId, account);
    }

    get(userId: string) {
        return this.accounts.get(userId);
    }

    getStats() {
        return { lockCount: this.lockCount, unlockCount: this.unlockCount };
    }

    clear(): void {
        this.accounts.clear();
        this.lockCount = 0;
        this.unlockCount = 0;
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

class InMemorySettlementRepo {
    private batches = new Map<string, SettlementBatch>();

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
        if (batch) batch.cantonTransactionId = txId;
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

    createEvent(): void {}
    logCompensationFailure(): void {}
    getBatches() {
        return Array.from(this.batches.values());
    }
    clear(): void {
        this.batches.clear();
    }
}

class MockPersistence {
    rehydrateOrderbook(_engine: MatchingEngine): { restoredCount: number } {
        return { restoredCount: 0 };
    }
    persistOrder(_order: Order): void {}
    removeOrder(_orderId: string): void {}
}

// ============================================
// Load Tests
// ============================================

describe("Concurrent Orders Load Tests", () => {
    let orderService: OrderService;
    let matchingEngine: MatchingEngine;
    let orderRepo: InMemoryOrderRepo;
    let tradeRepo: InMemoryTradeRepo;
    let accountRepo: InMemoryAccountRepo;
    let positionRepo: InMemoryPositionRepo;
    let marketRepo: InMemoryMarketRepo;
    let settlementRepo: InMemorySettlementRepo;

    const marketId = testId("market");

    beforeEach(() => {
        matchingEngine = new MatchingEngine();
        orderRepo = new InMemoryOrderRepo();
        tradeRepo = new InMemoryTradeRepo();
        accountRepo = new InMemoryAccountRepo();
        positionRepo = new InMemoryPositionRepo();
        marketRepo = new InMemoryMarketRepo();
        settlementRepo = new InMemorySettlementRepo();

        const persistence = new MockPersistence() as unknown as OrderbookPersistence;

        marketRepo.set(marketId, createMarket({ marketId, status: "open" }));

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
    });

    describe("High Volume Order Placement", () => {
        it("should handle 100 concurrent buy orders", async () => {
            // Set up 100 users with funds
            const users = Array.from({ length: 100 }, (_, i) => `user${i}`);
            for (const user of users) {
                accountRepo.set(
                    user,
                    createAccountProjection({
                        userId: user,
                        availableBalance: 10000,
                    }),
                );
            }

            const startTime = Date.now();

            // Place 100 orders concurrently
            const orderPromises = users.map((user, i) =>
                orderService.placeOrder(user, {
                    marketId,
                    side: "yes",
                    action: "buy",
                    orderType: "limit",
                    price: 0.5 + (i % 10) * 0.01, // Prices from 0.50 to 0.59
                    quantity: 100,
                }),
            );

            const results = await Promise.all(orderPromises);
            const endTime = Date.now();

            // Verify all orders were placed
            expect(results.length).toBe(100);
            expect(results.every((r) => r.orderId)).toBe(true);

            // Log performance
            const duration = endTime - startTime;
            console.log(`Placed 100 concurrent orders in ${duration}ms`);
            console.log(`Average: ${duration / 100}ms per order`);

            // Should complete in reasonable time (< 5 seconds)
            expect(duration).toBeLessThan(5000);
        });

        it("should handle 50 matching order pairs", async () => {
            // Set up buyers and sellers
            const buyers = Array.from({ length: 50 }, (_, i) => `buyer${i}`);
            const sellers = Array.from({ length: 50 }, (_, i) => `seller${i}`);

            for (const buyer of buyers) {
                accountRepo.set(
                    buyer,
                    createAccountProjection({
                        userId: buyer,
                        availableBalance: 10000,
                    }),
                );
            }

            for (const seller of sellers) {
                accountRepo.set(
                    seller,
                    createAccountProjection({
                        userId: seller,
                        availableBalance: 10000,
                    }),
                );
                // Give sellers YES shares
                positionRepo.set(
                    seller,
                    marketId,
                    "yes",
                    createPositionProjection({
                        userId: seller,
                        marketId,
                        side: "yes",
                        quantity: 100,
                        lockedQuantity: 0,
                    }),
                );
            }

            const startTime = Date.now();

            // First, place all sell orders
            const sellPromises = sellers.map((seller) =>
                orderService.placeOrder(seller, {
                    marketId,
                    side: "yes",
                    action: "sell",
                    orderType: "limit",
                    price: 0.5,
                    quantity: 100,
                }),
            );
            await Promise.all(sellPromises);

            // Then place matching buy orders
            const buyPromises = buyers.map((buyer) =>
                orderService.placeOrder(buyer, {
                    marketId,
                    side: "yes",
                    action: "buy",
                    orderType: "limit",
                    price: 0.5,
                    quantity: 100,
                }),
            );
            const buyResults = await Promise.all(buyPromises);

            const endTime = Date.now();

            // Verify matches occurred
            const trades = tradeRepo.getAll();
            expect(trades.length).toBe(50);

            // Verify all buy orders were filled
            const filledCount = buyResults.filter((r) => r.status === "filled").length;
            expect(filledCount).toBe(50);

            const duration = endTime - startTime;
            console.log(`Matched 50 order pairs in ${duration}ms`);
            console.log(`Average: ${duration / 50}ms per match`);

            expect(duration).toBeLessThan(10000);
        });
    });

    describe("Orderbook Stress Tests", () => {
        it("should maintain correct orderbook state under load", async () => {
            // Set up users
            const numUsers = 20;
            for (let i = 0; i < numUsers; i++) {
                accountRepo.set(
                    `user${i}`,
                    createAccountProjection({
                        userId: `user${i}`,
                        availableBalance: 100000,
                    }),
                );
            }

            // Place many orders at different price levels
            const orderPromises: Promise<unknown>[] = [];

            for (let i = 0; i < numUsers; i++) {
                // Each user places multiple orders at different prices
                for (let j = 0; j < 5; j++) {
                    orderPromises.push(
                        orderService.placeOrder(`user${i}`, {
                            marketId,
                            side: "yes",
                            action: "buy",
                            orderType: "limit",
                            price: 0.4 + j * 0.05,
                            quantity: 10,
                        }),
                    );
                }
            }

            await Promise.all(orderPromises);

            // Verify orderbook state
            const orderbook = matchingEngine.getOrderBook(marketId);

            // Should have orders at multiple price levels (YES bids)
            expect(orderbook.yes.bids.length).toBeGreaterThan(0);

            // Orders should be sorted by price (descending for bids)
            for (let i = 1; i < orderbook.yes.bids.length; i++) {
                expect(orderbook.yes.bids[i - 1].price.gte(orderbook.yes.bids[i].price)).toBe(true);
            }
        });

        it("should handle rapid order cancellations", async () => {
            const user = "cancelUser";
            accountRepo.set(
                user,
                createAccountProjection({
                    userId: user,
                    availableBalance: 100000,
                }),
            );

            // Place 20 orders
            const orderIds: string[] = [];
            for (let i = 0; i < 20; i++) {
                const result = await orderService.placeOrder(user, {
                    marketId,
                    side: "yes",
                    action: "buy",
                    orderType: "limit",
                    price: 0.3, // Low price - won't match
                    quantity: 100,
                });
                orderIds.push(result.orderId);
            }

            expect(orderIds.length).toBe(20);

            // Cancel all orders concurrently
            const cancelPromises = orderIds.map((orderId) => orderService.cancelOrder(user, orderId));

            const cancelResults = await Promise.all(cancelPromises);

            // All cancellations should succeed
            expect(cancelResults.every((r) => r.status === "cancelled")).toBe(true);

            // User should have no open orders
            const openOrders = orderService.getOpenOrdersByUser(user);
            expect(openOrders.length).toBe(0);

            // Funds should be fully unlocked
            const account = accountRepo.get(user)!;
            expect(account.lockedBalance.toNumber()).toBe(0);
        });
    });

    describe("Cross-Matching Load Tests", () => {
        it("should handle concurrent share creation orders", async () => {
            const numPairs = 25;
            const yesBuyers = Array.from({ length: numPairs }, (_, i) => `yesBuyer${i}`);
            const noBuyers = Array.from({ length: numPairs }, (_, i) => `noBuyer${i}`);

            // Set up all users
            for (const user of [...yesBuyers, ...noBuyers]) {
                accountRepo.set(
                    user,
                    createAccountProjection({
                        userId: user,
                        availableBalance: 10000,
                    }),
                );
            }

            const startTime = Date.now();

            // Place YES buy orders
            const yesPromises = yesBuyers.map((user) =>
                orderService.placeOrder(user, {
                    marketId,
                    side: "yes",
                    action: "buy",
                    orderType: "limit",
                    price: 0.6,
                    quantity: 100,
                }),
            );

            // Place NO buy orders (should cross-match with YES buys)
            const noPromises = noBuyers.map((user) =>
                orderService.placeOrder(user, {
                    marketId,
                    side: "no",
                    action: "buy",
                    orderType: "limit",
                    price: 0.4,
                    quantity: 100,
                }),
            );

            await Promise.all([...yesPromises, ...noPromises]);

            const endTime = Date.now();

            // Verify share creation trades
            const trades = tradeRepo.getAll();
            const shareCreationTrades = trades.filter((t) => t.tradeType === "share_creation");

            expect(shareCreationTrades.length).toBe(numPairs);

            const duration = endTime - startTime;
            console.log(`Created ${numPairs} share pairs in ${duration}ms`);
        });
    });

    describe("Memory and Resource Tests", () => {
        it("should not leak memory with many orders", async () => {
            const user = "memoryUser";
            accountRepo.set(
                user,
                createAccountProjection({
                    userId: user,
                    availableBalance: 1000000,
                }),
            );

            // Place and cancel many orders
            for (let batch = 0; batch < 10; batch++) {
                const orderIds: string[] = [];

                // Place 50 orders
                for (let i = 0; i < 50; i++) {
                    const result = await orderService.placeOrder(user, {
                        marketId,
                        side: "yes",
                        action: "buy",
                        orderType: "limit",
                        price: 0.2, // Very low - won't match
                        quantity: 10,
                    });
                    orderIds.push(result.orderId);
                }

                // Cancel all orders
                await Promise.all(orderIds.map((id) => orderService.cancelOrder(user, id)));
            }

            // Verify clean state
            const openOrders = orderService.getOpenOrdersByUser(user);
            expect(openOrders.length).toBe(0);

            const orderbook = matchingEngine.getOrderBook(marketId);
            expect(orderbook.yes.bids.length).toBe(0);
        });
    });

    describe("Multi-Market Concurrent Load", () => {
        it("should handle concurrent orders across multiple markets", async () => {
            const markets = Array.from({ length: 5 }, (_, i) => testId(`market${i}`));

            // Set up markets
            for (const mkt of markets) {
                marketRepo.set(mkt, createMarket({ marketId: mkt, status: "open" }));
            }

            // Set up users
            const numUsers = 10;
            for (let i = 0; i < numUsers; i++) {
                accountRepo.set(
                    `user${i}`,
                    createAccountProjection({
                        userId: `user${i}`,
                        availableBalance: 50000,
                    }),
                );
            }

            const startTime = Date.now();

            // Each user places orders in each market
            const allPromises: Promise<unknown>[] = [];

            for (let u = 0; u < numUsers; u++) {
                for (const mkt of markets) {
                    allPromises.push(
                        orderService.placeOrder(`user${u}`, {
                            marketId: mkt,
                            side: "yes",
                            action: "buy",
                            orderType: "limit",
                            price: 0.5,
                            quantity: 50,
                        }),
                    );
                }
            }

            await Promise.all(allPromises);

            const endTime = Date.now();

            // Verify each market has orders
            for (const mkt of markets) {
                const orderbook = matchingEngine.getOrderBook(mkt);
                expect(orderbook.yes.bids.length).toBeGreaterThan(0);
            }

            const totalOrders = numUsers * markets.length;
            const duration = endTime - startTime;
            console.log(`Placed ${totalOrders} orders across ${markets.length} markets in ${duration}ms`);
        });
    });
});
