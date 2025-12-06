/**
 * Unit tests for InMemoryOrderBook
 *
 * Tests:
 * - Order insertion and retrieval
 * - Price-time priority sorting
 * - Level aggregation
 * - Order updates and removal
 */

import { describe, it, expect, beforeEach } from "bun:test";
import Decimal from "decimal.js";
import { InMemoryOrderBook } from "../../../src/matching/orderbook";
import { createBuyYesOrder, createSellYesOrder, createBuyNoOrder, createSellNoOrder } from "../../setup/test-fixtures";
import { expectDecimalEquals, expectOrderBookLevel, withTimeOffset } from "../../setup/test-helpers";

describe("InMemoryOrderBook", () => {
    let orderBook: InMemoryOrderBook;
    const marketId = "test-market";

    beforeEach(() => {
        orderBook = new InMemoryOrderBook(marketId);
    });

    describe("order insertion", () => {
        it("should add buy YES orders to yesBids", () => {
            const order = createBuyYesOrder({ marketId });
            orderBook.addOrder(order);

            expect(orderBook.getYesBids()).toHaveLength(1);
            expect(orderBook.getYesBids()[0].orderId).toBe(order.orderId);
        });

        it("should add sell YES orders to yesAsks", () => {
            const order = createSellYesOrder({ marketId });
            orderBook.addOrder(order);

            expect(orderBook.getYesAsks()).toHaveLength(1);
            expect(orderBook.getYesAsks()[0].orderId).toBe(order.orderId);
        });

        it("should add buy NO orders to noBids", () => {
            const order = createBuyNoOrder({ marketId });
            orderBook.addOrder(order);

            expect(orderBook.getNoBids()).toHaveLength(1);
            expect(orderBook.getNoBids()[0].orderId).toBe(order.orderId);
        });

        it("should add sell NO orders to noAsks", () => {
            const order = createSellNoOrder({ marketId });
            orderBook.addOrder(order);

            expect(orderBook.getNoAsks()).toHaveLength(1);
            expect(orderBook.getNoAsks()[0].orderId).toBe(order.orderId);
        });

        it("should reject orders with wrong marketId", () => {
            const order = createBuyYesOrder({ marketId: "other-market" });

            expect(() => orderBook.addOrder(order)).toThrow("Order market other-market doesn't match book test-market");
        });
    });

    describe("price-time priority sorting", () => {
        describe("bids (buy orders)", () => {
            it("should sort bids by price descending (highest first)", () => {
                const now = new Date();
                const order1 = createBuyYesOrder({ marketId, price: 0.45, createdAt: now });
                const order2 = createBuyYesOrder({ marketId, price: 0.5, createdAt: now });
                const order3 = createBuyYesOrder({ marketId, price: 0.48, createdAt: now });

                orderBook.addOrder(order1);
                orderBook.addOrder(order2);
                orderBook.addOrder(order3);

                const bids = orderBook.getYesBids();
                expect(bids).toHaveLength(3);
                expectDecimalEquals(bids[0].price, 0.5);
                expectDecimalEquals(bids[1].price, 0.48);
                expectDecimalEquals(bids[2].price, 0.45);
            });

            it("should sort by time (FIFO) when prices are equal", () => {
                const now = new Date();
                const order1 = createBuyYesOrder({
                    marketId,
                    price: 0.5,
                    orderId: "order-1",
                    createdAt: withTimeOffset(now, 0),
                });
                const order2 = createBuyYesOrder({
                    marketId,
                    price: 0.5,
                    orderId: "order-2",
                    createdAt: withTimeOffset(now, 100),
                });
                const order3 = createBuyYesOrder({
                    marketId,
                    price: 0.5,
                    orderId: "order-3",
                    createdAt: withTimeOffset(now, 50),
                });

                orderBook.addOrder(order1);
                orderBook.addOrder(order2);
                orderBook.addOrder(order3);

                const bids = orderBook.getYesBids();
                expect(bids).toHaveLength(3);
                expect(bids[0].orderId).toBe("order-1"); // Earliest
                expect(bids[1].orderId).toBe("order-3");
                expect(bids[2].orderId).toBe("order-2"); // Latest
            });
        });

        describe("asks (sell orders)", () => {
            it("should sort asks by price ascending (lowest first)", () => {
                const now = new Date();
                const order1 = createSellYesOrder({ marketId, price: 0.55, createdAt: now });
                const order2 = createSellYesOrder({ marketId, price: 0.5, createdAt: now });
                const order3 = createSellYesOrder({ marketId, price: 0.52, createdAt: now });

                orderBook.addOrder(order1);
                orderBook.addOrder(order2);
                orderBook.addOrder(order3);

                const asks = orderBook.getYesAsks();
                expect(asks).toHaveLength(3);
                expectDecimalEquals(asks[0].price, 0.5);
                expectDecimalEquals(asks[1].price, 0.52);
                expectDecimalEquals(asks[2].price, 0.55);
            });

            it("should sort by time (FIFO) when prices are equal", () => {
                const now = new Date();
                const order1 = createSellYesOrder({
                    marketId,
                    price: 0.5,
                    orderId: "order-1",
                    createdAt: withTimeOffset(now, 100),
                });
                const order2 = createSellYesOrder({
                    marketId,
                    price: 0.5,
                    orderId: "order-2",
                    createdAt: withTimeOffset(now, 0),
                });
                const order3 = createSellYesOrder({
                    marketId,
                    price: 0.5,
                    orderId: "order-3",
                    createdAt: withTimeOffset(now, 50),
                });

                orderBook.addOrder(order1);
                orderBook.addOrder(order2);
                orderBook.addOrder(order3);

                const asks = orderBook.getYesAsks();
                expect(asks).toHaveLength(3);
                expect(asks[0].orderId).toBe("order-2"); // Earliest
                expect(asks[1].orderId).toBe("order-3");
                expect(asks[2].orderId).toBe("order-1"); // Latest
            });
        });
    });

    describe("order retrieval", () => {
        it("should find order by ID", () => {
            const order = createBuyYesOrder({ marketId, orderId: "find-me" });
            orderBook.addOrder(order);

            const found = orderBook.getOrder("find-me");
            expect(found).not.toBeNull();
            expect(found!.orderId).toBe("find-me");
        });

        it("should return null for non-existent order", () => {
            const found = orderBook.getOrder("does-not-exist");
            expect(found).toBeNull();
        });

        it("should check if order exists", () => {
            const order = createBuyYesOrder({ marketId, orderId: "exists" });
            orderBook.addOrder(order);

            expect(orderBook.hasOrder("exists")).toBe(true);
            expect(orderBook.hasOrder("does-not-exist")).toBe(false);
        });
    });

    describe("order removal", () => {
        it("should remove order from book", () => {
            const order = createBuyYesOrder({ marketId, orderId: "remove-me" });
            orderBook.addOrder(order);
            expect(orderBook.getYesBids()).toHaveLength(1);

            const removed = orderBook.removeOrder("remove-me");
            expect(removed).toBe(true);
            expect(orderBook.getYesBids()).toHaveLength(0);
        });

        it("should return false when removing non-existent order", () => {
            const removed = orderBook.removeOrder("does-not-exist");
            expect(removed).toBe(false);
        });

        it("should remove from correct side", () => {
            const buyOrder = createBuyYesOrder({ marketId, orderId: "buy" });
            const sellOrder = createSellYesOrder({ marketId, orderId: "sell" });

            orderBook.addOrder(buyOrder);
            orderBook.addOrder(sellOrder);

            orderBook.removeOrder("buy");
            expect(orderBook.getYesBids()).toHaveLength(0);
            expect(orderBook.getYesAsks()).toHaveLength(1);
        });
    });

    describe("order update", () => {
        it("should update existing order", () => {
            const order = createBuyYesOrder({
                marketId,
                orderId: "update-me",
                filledQuantity: 0,
            });
            orderBook.addOrder(order);

            const updatedOrder = {
                ...order,
                filledQuantity: new Decimal(50),
            };
            const success = orderBook.updateOrder(updatedOrder);

            expect(success).toBe(true);
            const retrieved = orderBook.getOrder("update-me");
            expectDecimalEquals(retrieved!.filledQuantity, 50);
        });

        it("should return false when updating non-existent order", () => {
            const order = createBuyYesOrder({ marketId, orderId: "fake" });
            const success = orderBook.updateOrder(order);
            expect(success).toBe(false);
        });
    });

    describe("level aggregation", () => {
        it("should aggregate orders at same price level", () => {
            const now = new Date();
            orderBook.addOrder(createBuyYesOrder({ marketId, price: 0.5, quantity: 100, createdAt: now }));
            orderBook.addOrder(createBuyYesOrder({ marketId, price: 0.5, quantity: 50, createdAt: now }));
            orderBook.addOrder(createBuyYesOrder({ marketId, price: 0.48, quantity: 200, createdAt: now }));

            const book = orderBook.toOrderBook();
            expect(book.yes.bids).toHaveLength(2);

            // First level (best bid)
            expectOrderBookLevel(book.yes.bids[0], {
                price: 0.5,
                quantity: 150,
                orderCount: 2,
            });

            // Second level
            expectOrderBookLevel(book.yes.bids[1], {
                price: 0.48,
                quantity: 200,
                orderCount: 1,
            });
        });

        it("should exclude fully filled orders from aggregation", () => {
            const filledOrder = createBuyYesOrder({
                marketId,
                price: 0.5,
                quantity: 100,
                filledQuantity: 100,
            });
            const openOrder = createBuyYesOrder({
                marketId,
                price: 0.5,
                quantity: 100,
                filledQuantity: 0,
            });

            orderBook.addOrder(filledOrder);
            orderBook.addOrder(openOrder);

            const book = orderBook.toOrderBook();
            expect(book.yes.bids).toHaveLength(1);
            expectOrderBookLevel(book.yes.bids[0], {
                price: 0.5,
                quantity: 100,
                orderCount: 1,
            });
        });

        it("should handle partial fills correctly", () => {
            const partialOrder = createBuyYesOrder({
                marketId,
                price: 0.5,
                quantity: 100,
                filledQuantity: 30,
            });

            orderBook.addOrder(partialOrder);

            const book = orderBook.toOrderBook();
            expect(book.yes.bids).toHaveLength(1);
            expectOrderBookLevel(book.yes.bids[0], {
                price: 0.5,
                quantity: 70, // 100 - 30 remaining
                orderCount: 1,
            });
        });
    });

    describe("toOrderBook snapshot", () => {
        it("should return complete orderbook structure", () => {
            orderBook.addOrder(createBuyYesOrder({ marketId, price: 0.45 }));
            orderBook.addOrder(createSellYesOrder({ marketId, price: 0.55 }));
            orderBook.addOrder(createBuyNoOrder({ marketId, price: 0.55 }));
            orderBook.addOrder(createSellNoOrder({ marketId, price: 0.45 }));

            const book = orderBook.toOrderBook();

            expect(book.marketId).toBe(marketId);
            expect(book.yes.bids).toHaveLength(1);
            expect(book.yes.asks).toHaveLength(1);
            expect(book.no.bids).toHaveLength(1);
            expect(book.no.asks).toHaveLength(1);
            expect(book.lastUpdated).toBeInstanceOf(Date);
        });

        it("should return empty book when no orders", () => {
            const book = orderBook.toOrderBook();

            expect(book.marketId).toBe(marketId);
            expect(book.yes.bids).toHaveLength(0);
            expect(book.yes.asks).toHaveLength(0);
            expect(book.no.bids).toHaveLength(0);
            expect(book.no.asks).toHaveLength(0);
        });
    });

    describe("getAllOrders", () => {
        it("should return all orders from all sides", () => {
            orderBook.addOrder(createBuyYesOrder({ marketId }));
            orderBook.addOrder(createSellYesOrder({ marketId }));
            orderBook.addOrder(createBuyNoOrder({ marketId }));
            orderBook.addOrder(createSellNoOrder({ marketId }));

            const allOrders = orderBook.getAllOrders();
            expect(allOrders).toHaveLength(4);
        });

        it("should return empty array for empty book", () => {
            const allOrders = orderBook.getAllOrders();
            expect(allOrders).toHaveLength(0);
        });
    });

    describe("getOrderCount", () => {
        it("should return total order count", () => {
            expect(orderBook.getOrderCount()).toBe(0);

            orderBook.addOrder(createBuyYesOrder({ marketId }));
            expect(orderBook.getOrderCount()).toBe(1);

            orderBook.addOrder(createSellYesOrder({ marketId }));
            orderBook.addOrder(createBuyNoOrder({ marketId }));
            expect(orderBook.getOrderCount()).toBe(3);
        });
    });

    describe("clear", () => {
        it("should remove all orders", () => {
            orderBook.addOrder(createBuyYesOrder({ marketId }));
            orderBook.addOrder(createSellYesOrder({ marketId }));
            orderBook.addOrder(createBuyNoOrder({ marketId }));
            orderBook.addOrder(createSellNoOrder({ marketId }));

            expect(orderBook.getOrderCount()).toBe(4);

            orderBook.clear();

            expect(orderBook.getOrderCount()).toBe(0);
            expect(orderBook.getYesBids()).toHaveLength(0);
            expect(orderBook.getYesAsks()).toHaveLength(0);
            expect(orderBook.getNoBids()).toHaveLength(0);
            expect(orderBook.getNoAsks()).toHaveLength(0);
        });
    });
});
