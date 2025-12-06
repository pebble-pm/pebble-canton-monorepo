/**
 * Integration tests for Crash Recovery
 *
 * Tests system recovery after simulated failures
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import Decimal from "decimal.js";
import { MatchingEngine, OrderbookPersistence } from "../../src/matching";
import type { Order, OrderStatus } from "../../src/types";
import { testId } from "../setup/test-env";

// ============================================
// Mock Order Repository
// ============================================

class MockOrderRepository {
    private orders = new Map<string, Order>();
    private ordersWithPendingSettlements = new Set<string>();

    create(order: Order): void {
        this.orders.set(order.orderId, order);
    }

    getById(orderId: string): Order | null {
        return this.orders.get(orderId) ?? null;
    }

    getOpenOrders(marketId?: string): Order[] {
        return Array.from(this.orders.values()).filter(
            (o) => (o.status === "open" || o.status === "partial") && (!marketId || o.marketId === marketId),
        );
    }

    updateFilled(orderId: string, filledQuantity: Decimal, status: OrderStatus): void {
        const order = this.orders.get(orderId);
        if (order) {
            order.filledQuantity = filledQuantity;
            order.status = status;
        }
    }

    updateStatus(orderId: string, status: OrderStatus): void {
        const order = this.orders.get(orderId);
        if (order) {
            order.status = status;
        }
    }

    delete(orderId: string): void {
        this.orders.delete(orderId);
    }

    getOrdersWithPendingSettlements(): string[] {
        return Array.from(this.ordersWithPendingSettlements);
    }

    // Test helper
    addPendingSettlement(orderId: string): void {
        this.ordersWithPendingSettlements.add(orderId);
    }

    clear(): void {
        this.orders.clear();
        this.ordersWithPendingSettlements.clear();
    }
}

// ============================================
// Test Setup
// ============================================

let db: Database;
let orderRepo: MockOrderRepository;

function setupDatabase(): Database {
    const database = new Database(":memory:");

    // Create settlement batches table
    database.run(`
    CREATE TABLE settlement_batches (
      batch_id TEXT PRIMARY KEY,
      trade_ids TEXT NOT NULL,
      status TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      canton_transaction_id TEXT,
      last_error TEXT
    )
  `);

    // Create trades table
    database.run(`
    CREATE TABLE trades (
      trade_id TEXT PRIMARY KEY,
      market_id TEXT NOT NULL,
      buy_order_id TEXT NOT NULL,
      sell_order_id TEXT NOT NULL,
      buyer_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      trade_type TEXT NOT NULL,
      settlement_status TEXT NOT NULL DEFAULT 'pending',
      settlement_id TEXT,
      created_at TEXT NOT NULL
    )
  `);

    return database;
}

beforeEach(() => {
    db = setupDatabase();
    orderRepo = new MockOrderRepository();
});

afterEach(() => {
    db.close();
});

// ============================================
// Orderbook Recovery Tests
// ============================================

describe("Crash Recovery Integration", () => {
    describe("Orderbook Persistence and Recovery", () => {
        it("should persist orders to repository", () => {
            const persistence = new OrderbookPersistence(orderRepo as never);
            const marketId = testId("market");

            const order: Order = {
                orderId: testId("order"),
                marketId,
                userId: "alice",
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: new Decimal(0.5),
                quantity: new Decimal(100),
                filledQuantity: new Decimal(0),
                status: "open",
                lockedAmount: new Decimal(50),
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            persistence.persistOrder(order);

            const stored = orderRepo.getById(order.orderId);
            expect(stored).not.toBeNull();
            expect(stored!.orderId).toBe(order.orderId);
        });

        it("should rehydrate orderbook from repository after restart", () => {
            const persistence = new OrderbookPersistence(orderRepo as never);
            const marketId = testId("market");

            // Persist multiple orders
            const orders: Order[] = [
                {
                    orderId: testId("order1"),
                    marketId,
                    userId: "alice",
                    side: "yes",
                    action: "buy",
                    orderType: "limit",
                    price: new Decimal(0.5),
                    quantity: new Decimal(100),
                    filledQuantity: new Decimal(0),
                    status: "open",
                    lockedAmount: new Decimal(50),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    orderId: testId("order2"),
                    marketId,
                    userId: "bob",
                    side: "yes",
                    action: "sell",
                    orderType: "limit",
                    price: new Decimal(0.6),
                    quantity: new Decimal(50),
                    filledQuantity: new Decimal(0),
                    status: "open",
                    lockedAmount: new Decimal(0),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    orderId: testId("order3"),
                    marketId,
                    userId: "charlie",
                    side: "no",
                    action: "buy",
                    orderType: "limit",
                    price: new Decimal(0.4),
                    quantity: new Decimal(75),
                    filledQuantity: new Decimal(0),
                    status: "open",
                    lockedAmount: new Decimal(30),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ];

            for (const order of orders) {
                persistence.persistOrder(order);
            }

            // Simulate restart - create new engine (same repository simulates persistence)
            const newEngine = new MatchingEngine();
            const newPersistence = new OrderbookPersistence(orderRepo as never);

            const { restoredCount } = newPersistence.rehydrateOrderbook(newEngine);

            expect(restoredCount).toBe(3);

            // Verify orders are in the engine
            const orderbook = newEngine.getOrderBook(marketId);
            const totalOrders = orderbook.yes.bids.length + orderbook.yes.asks.length + orderbook.no.bids.length + orderbook.no.asks.length;
            expect(totalOrders).toBeGreaterThan(0);
        });

        it("should not restore cancelled or filled orders", () => {
            const persistence = new OrderbookPersistence(orderRepo as never);
            const marketId = testId("market");

            // Persist orders with different statuses
            const openOrder: Order = {
                orderId: testId("open-order"),
                marketId,
                userId: "alice",
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: new Decimal(0.5),
                quantity: new Decimal(100),
                filledQuantity: new Decimal(0),
                status: "open",
                lockedAmount: new Decimal(50),
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const cancelledOrder: Order = {
                orderId: testId("cancelled-order"),
                marketId,
                userId: "bob",
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: new Decimal(0.4),
                quantity: new Decimal(50),
                filledQuantity: new Decimal(0),
                status: "cancelled",
                lockedAmount: new Decimal(0),
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const filledOrder: Order = {
                orderId: testId("filled-order"),
                marketId,
                userId: "charlie",
                side: "yes",
                action: "sell",
                orderType: "limit",
                price: new Decimal(0.6),
                quantity: new Decimal(75),
                filledQuantity: new Decimal(75),
                status: "filled",
                lockedAmount: new Decimal(0),
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            persistence.persistOrder(openOrder);
            persistence.persistOrder(cancelledOrder);
            persistence.persistOrder(filledOrder);

            // Rehydrate
            const newEngine = new MatchingEngine();
            const newPersistence = new OrderbookPersistence(orderRepo as never);
            const { restoredCount } = newPersistence.rehydrateOrderbook(newEngine);

            // Only open orders should be restored
            expect(restoredCount).toBe(1);
        });

        it("should handle partial orders correctly on recovery", () => {
            const persistence = new OrderbookPersistence(orderRepo as never);
            const marketId = testId("market");

            const partialOrder: Order = {
                orderId: testId("partial-order"),
                marketId,
                userId: "alice",
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: new Decimal(0.5),
                quantity: new Decimal(100),
                filledQuantity: new Decimal(40),
                status: "partial",
                lockedAmount: new Decimal(30),
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            persistence.persistOrder(partialOrder);

            const newEngine = new MatchingEngine();
            const newPersistence = new OrderbookPersistence(orderRepo as never);
            const { restoredCount } = newPersistence.rehydrateOrderbook(newEngine);

            expect(restoredCount).toBe(1);

            // Get the restored order from orderbook
            const orderbook = newEngine.getOrderBook(marketId);
            // The order is a YES buy, so it should be in yes.bids
            expect(orderbook.yes.bids.length).toBe(1);
            // The bid shows remaining quantity (60) at price level 0.5
            expect(orderbook.yes.bids[0].price.toNumber()).toBe(0.5);
            expect(orderbook.yes.bids[0].quantity.toNumber()).toBe(60); // 100 - 40 filled
        });

        it("should remove order from repository when deleted", () => {
            const persistence = new OrderbookPersistence(orderRepo as never);
            const orderId = testId("order");
            const marketId = testId("market");

            const order: Order = {
                orderId,
                marketId,
                userId: "alice",
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: new Decimal(0.5),
                quantity: new Decimal(100),
                filledQuantity: new Decimal(0),
                status: "open",
                lockedAmount: new Decimal(50),
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            persistence.persistOrder(order);
            expect(orderRepo.getById(orderId)).not.toBeNull();

            persistence.deleteOrder(orderId);
            expect(orderRepo.getById(orderId)).toBeNull();
        });
    });

    describe("Settlement Recovery", () => {
        it("should find pending settlement batches after restart", () => {
            // Insert a pending batch
            const batchId = testId("batch");
            const tradeIds = JSON.stringify([testId("trade1"), testId("trade2")]);

            db.run(
                `
        INSERT INTO settlement_batches (batch_id, trade_ids, status, retry_count, created_at, updated_at)
        VALUES (?, ?, 'pending', 0, ?, ?)
      `,
                [batchId, tradeIds, new Date().toISOString(), new Date().toISOString()],
            );

            // Query for pending batches
            const pendingBatches = db
                .query(`
        SELECT * FROM settlement_batches WHERE status IN ('pending', 'retrying')
      `)
                .all();

            expect(pendingBatches.length).toBe(1);
            expect((pendingBatches[0] as { batch_id: string }).batch_id).toBe(batchId);
        });

        it("should find retrying batches with retry count < max", () => {
            const maxRetries = 3;

            // Insert batches with different retry counts
            db.run(
                `
        INSERT INTO settlement_batches (batch_id, trade_ids, status, retry_count, created_at, updated_at)
        VALUES (?, ?, 'retrying', 1, ?, ?)
      `,
                [testId("batch1"), "[]", new Date().toISOString(), new Date().toISOString()],
            );

            db.run(
                `
        INSERT INTO settlement_batches (batch_id, trade_ids, status, retry_count, created_at, updated_at)
        VALUES (?, ?, 'retrying', 3, ?, ?)
      `,
                [testId("batch2"), "[]", new Date().toISOString(), new Date().toISOString()],
            );

            db.run(
                `
        INSERT INTO settlement_batches (batch_id, trade_ids, status, retry_count, created_at, updated_at)
        VALUES (?, ?, 'retrying', 5, ?, ?)
      `,
                [testId("batch3"), "[]", new Date().toISOString(), new Date().toISOString()],
            );

            // Find batches eligible for retry
            const retryableBatches = db
                .query(`
        SELECT * FROM settlement_batches WHERE status = 'retrying' AND retry_count < ?
      `)
                .all(maxRetries);

            expect(retryableBatches.length).toBe(1);
        });

        it("should not retry completed batches", () => {
            db.run(
                `
        INSERT INTO settlement_batches (batch_id, trade_ids, status, retry_count, created_at, updated_at, canton_transaction_id)
        VALUES (?, ?, 'completed', 0, ?, ?, ?)
      `,
                [testId("batch"), "[]", new Date().toISOString(), new Date().toISOString(), "tx-123"],
            );

            const pendingBatches = db
                .query(`
        SELECT * FROM settlement_batches WHERE status IN ('pending', 'retrying')
      `)
                .all();

            expect(pendingBatches.length).toBe(0);
        });

        it("should not retry failed batches", () => {
            db.run(
                `
        INSERT INTO settlement_batches (batch_id, trade_ids, status, retry_count, created_at, updated_at, last_error)
        VALUES (?, ?, 'failed', 5, ?, ?, ?)
      `,
                [testId("batch"), "[]", new Date().toISOString(), new Date().toISOString(), "Max retries exceeded"],
            );

            const pendingBatches = db
                .query(`
        SELECT * FROM settlement_batches WHERE status IN ('pending', 'retrying')
      `)
                .all();

            expect(pendingBatches.length).toBe(0);
        });
    });

    describe("Trade Recovery", () => {
        it("should find unsettled trades after restart", () => {
            const marketId = testId("market");

            // Insert pending trades
            db.run(
                `
        INSERT INTO trades (trade_id, market_id, buy_order_id, sell_order_id, buyer_id, seller_id, quantity, price, trade_type, settlement_status, created_at)
        VALUES (?, ?, ?, ?, 'alice', 'bob', 100, 0.5, 'share_transfer', 'pending', ?)
      `,
                [testId("trade1"), marketId, testId("buy1"), testId("sell1"), new Date().toISOString()],
            );

            db.run(
                `
        INSERT INTO trades (trade_id, market_id, buy_order_id, sell_order_id, buyer_id, seller_id, quantity, price, trade_type, settlement_status, created_at)
        VALUES (?, ?, ?, ?, 'charlie', 'dave', 50, 0.6, 'share_transfer', 'pending', ?)
      `,
                [testId("trade2"), marketId, testId("buy2"), testId("sell2"), new Date().toISOString()],
            );

            // Insert settled trade (should not appear)
            db.run(
                `
        INSERT INTO trades (trade_id, market_id, buy_order_id, sell_order_id, buyer_id, seller_id, quantity, price, trade_type, settlement_status, settlement_id, created_at)
        VALUES (?, ?, ?, ?, 'eve', 'frank', 75, 0.55, 'share_transfer', 'settled', ?, ?)
      `,
                [testId("trade3"), marketId, testId("buy3"), testId("sell3"), testId("batch"), new Date().toISOString()],
            );

            const pendingTrades = db
                .query(`
        SELECT * FROM trades WHERE settlement_status = 'pending'
      `)
                .all();

            expect(pendingTrades.length).toBe(2);
        });
    });

    describe("Multi-Market Recovery", () => {
        it("should restore orders for multiple markets", () => {
            const persistence = new OrderbookPersistence(orderRepo as never);
            const market1 = testId("market1");
            const market2 = testId("market2");

            // Orders in market 1
            persistence.persistOrder({
                orderId: testId("m1-order1"),
                marketId: market1,
                userId: "alice",
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: new Decimal(0.5),
                quantity: new Decimal(100),
                filledQuantity: new Decimal(0),
                status: "open",
                lockedAmount: new Decimal(50),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            persistence.persistOrder({
                orderId: testId("m1-order2"),
                marketId: market1,
                userId: "bob",
                side: "no",
                action: "buy",
                orderType: "limit",
                price: new Decimal(0.4),
                quantity: new Decimal(50),
                filledQuantity: new Decimal(0),
                status: "open",
                lockedAmount: new Decimal(20),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            // Orders in market 2
            persistence.persistOrder({
                orderId: testId("m2-order1"),
                marketId: market2,
                userId: "charlie",
                side: "yes",
                action: "sell",
                orderType: "limit",
                price: new Decimal(0.7),
                quantity: new Decimal(75),
                filledQuantity: new Decimal(0),
                status: "open",
                lockedAmount: new Decimal(0),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            // Rehydrate
            const newEngine = new MatchingEngine();
            const newPersistence = new OrderbookPersistence(orderRepo as never);
            const { restoredCount } = newPersistence.rehydrateOrderbook(newEngine);

            expect(restoredCount).toBe(3);

            // Verify both markets have orders
            const orderbook1 = newEngine.getOrderBook(market1);
            const orderbook2 = newEngine.getOrderBook(market2);

            const market1Orders =
                orderbook1.yes.bids.length + orderbook1.yes.asks.length + orderbook1.no.bids.length + orderbook1.no.asks.length;
            const market2Orders =
                orderbook2.yes.bids.length + orderbook2.yes.asks.length + orderbook2.no.bids.length + orderbook2.no.asks.length;

            expect(market1Orders).toBe(2);
            expect(market2Orders).toBe(1);
        });
    });

    describe("Edge Cases", () => {
        it("should handle empty repository on recovery", () => {
            const newEngine = new MatchingEngine();
            const newPersistence = new OrderbookPersistence(orderRepo as never);
            const { restoredCount } = newPersistence.rehydrateOrderbook(newEngine);

            expect(restoredCount).toBe(0);
        });

        it("should exclude orders with pending settlements", () => {
            const persistence = new OrderbookPersistence(orderRepo as never);
            const marketId = testId("market");

            const order1: Order = {
                orderId: testId("order1"),
                marketId,
                userId: "alice",
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: new Decimal(0.5),
                quantity: new Decimal(100),
                filledQuantity: new Decimal(0),
                status: "open",
                lockedAmount: new Decimal(50),
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const order2: Order = {
                orderId: testId("order2"),
                marketId,
                userId: "bob",
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: new Decimal(0.5),
                quantity: new Decimal(50),
                filledQuantity: new Decimal(0),
                status: "open",
                lockedAmount: new Decimal(25),
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            persistence.persistOrder(order1);
            persistence.persistOrder(order2);

            // Mark order1 as having pending settlement
            orderRepo.addPendingSettlement(order1.orderId);

            const newEngine = new MatchingEngine();
            const newPersistence = new OrderbookPersistence(orderRepo as never);
            const { restoredCount, excludedCount } = newPersistence.rehydrateOrderbook(newEngine);

            expect(restoredCount).toBe(1);
            expect(excludedCount).toBe(1);
        });

        it("should preserve order priority on recovery", () => {
            const persistence = new OrderbookPersistence(orderRepo as never);
            const marketId = testId("market");

            // Create orders with different timestamps
            const order1: Order = {
                orderId: testId("order1"),
                marketId,
                userId: "alice",
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: new Decimal(0.5),
                quantity: new Decimal(100),
                filledQuantity: new Decimal(0),
                status: "open",
                lockedAmount: new Decimal(50),
                createdAt: new Date(Date.now() - 3000), // Oldest
                updatedAt: new Date(),
            };

            const order2: Order = {
                orderId: testId("order2"),
                marketId,
                userId: "bob",
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: new Decimal(0.5), // Same price
                quantity: new Decimal(50),
                filledQuantity: new Decimal(0),
                status: "open",
                lockedAmount: new Decimal(25),
                createdAt: new Date(Date.now() - 2000),
                updatedAt: new Date(),
            };

            const order3: Order = {
                orderId: testId("order3"),
                marketId,
                userId: "charlie",
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: new Decimal(0.5), // Same price
                quantity: new Decimal(75),
                filledQuantity: new Decimal(0),
                status: "open",
                lockedAmount: new Decimal(37.5),
                createdAt: new Date(Date.now() - 1000), // Newest
                updatedAt: new Date(),
            };

            persistence.persistOrder(order3); // Insert in different order
            persistence.persistOrder(order1);
            persistence.persistOrder(order2);

            // Rehydrate
            const newEngine = new MatchingEngine();
            const newPersistence = new OrderbookPersistence(orderRepo as never);
            newPersistence.rehydrateOrderbook(newEngine);

            // Get orderbook and verify order - all 3 orders are YES buys at same price
            // They get aggregated into a single price level
            const orderbook = newEngine.getOrderBook(marketId);
            expect(orderbook.yes.bids.length).toBe(1); // Aggregated into one level

            // Total quantity should be sum of all orders: 100 + 50 + 75 = 225
            expect(orderbook.yes.bids[0].price.toNumber()).toBe(0.5);
            expect(orderbook.yes.bids[0].quantity.toNumber()).toBe(225);
        });
    });
});
