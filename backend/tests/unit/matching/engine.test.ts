/**
 * Unit tests for MatchingEngine
 *
 * Tests:
 * - Basic order matching
 * - Partial fills
 * - Market orders
 * - Order cancellation
 * - Orderbook management
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { MatchingEngine } from "../../../src/matching/engine";
import { createBuyYesOrder, createSellYesOrder, createOrder } from "../../setup/test-fixtures";
import { expectDecimalEquals, expectTrade, expectOrderStatus, withTimeOffset } from "../../setup/test-helpers";

describe("MatchingEngine", () => {
    let engine: MatchingEngine;
    const marketId = "test-market";

    beforeEach(() => {
        engine = new MatchingEngine();
    });

    describe("basic matching", () => {
        it("should match buy order with existing sell order", () => {
            // Add a sell order first
            const sellOrder = createSellYesOrder({
                marketId,
                price: 0.5,
                quantity: 100,
                userId: "seller",
            });
            engine.processOrder(sellOrder);

            // Place a buy order that matches
            const buyOrder = createBuyYesOrder({
                marketId,
                price: 0.5,
                quantity: 100,
                userId: "buyer",
            });
            const result = engine.processOrder(buyOrder);

            expect(result.trades).toHaveLength(1);
            expect(result.orderStatus).toBe("filled");
            expectDecimalEquals(result.filledQuantity, 100);

            expectTrade(result.trades[0], {
                buyerId: "buyer",
                sellerId: "seller",
                side: "yes",
                price: 0.5,
                quantity: 100,
                tradeType: "share_trade",
            });
        });

        it("should match sell order with existing buy order", () => {
            // Add a buy order first
            const buyOrder = createBuyYesOrder({
                marketId,
                price: 0.5,
                quantity: 100,
                userId: "buyer",
            });
            engine.processOrder(buyOrder);

            // Place a sell order that matches
            const sellOrder = createSellYesOrder({
                marketId,
                price: 0.5,
                quantity: 100,
                userId: "seller",
            });
            const result = engine.processOrder(sellOrder);

            expect(result.trades).toHaveLength(1);
            expect(result.orderStatus).toBe("filled");
            expectDecimalEquals(result.filledQuantity, 100);
        });

        it("should add order to book when no match exists", () => {
            const buyOrder = createBuyYesOrder({
                marketId,
                price: 0.4,
                quantity: 100,
                userId: "buyer",
            });
            const result = engine.processOrder(buyOrder);

            expect(result.trades).toHaveLength(0);
            expect(result.orderStatus).toBe("open");
            expect(result.remainingOrder).not.toBeNull();

            const book = engine.getOrderBook(marketId);
            expect(book.yes.bids).toHaveLength(1);
        });

        it("should not match orders with incompatible prices", () => {
            // Add sell at 0.55
            engine.processOrder(createSellYesOrder({ marketId, price: 0.55, userId: "seller" }));

            // Buy at 0.50 should not match
            const result = engine.processOrder(createBuyYesOrder({ marketId, price: 0.5, userId: "buyer" }));

            expect(result.trades).toHaveLength(0);
            expect(result.orderStatus).toBe("open");
        });

        it("should give price improvement to taker (incoming order)", () => {
            // Seller posts at 0.45
            engine.processOrder(
                createSellYesOrder({
                    marketId,
                    price: 0.45,
                    quantity: 100,
                    userId: "seller",
                }),
            );

            // Buyer willing to pay 0.50 gets executed at 0.45 (price improvement)
            const result = engine.processOrder(
                createBuyYesOrder({
                    marketId,
                    price: 0.5,
                    quantity: 100,
                    userId: "buyer",
                }),
            );

            expect(result.trades).toHaveLength(1);
            expectDecimalEquals(result.trades[0].price, 0.45); // Maker's price
        });
    });

    describe("partial fills", () => {
        it("should partially fill when order is larger than available", () => {
            // Add small sell order
            engine.processOrder(
                createSellYesOrder({
                    marketId,
                    price: 0.5,
                    quantity: 50,
                    userId: "seller",
                }),
            );

            // Place larger buy order
            const result = engine.processOrder(
                createBuyYesOrder({
                    marketId,
                    price: 0.5,
                    quantity: 100,
                    userId: "buyer",
                }),
            );

            expect(result.trades).toHaveLength(1);
            expect(result.orderStatus).toBe("partial");
            expectDecimalEquals(result.filledQuantity, 50);
            expect(result.remainingOrder).not.toBeNull();
            expectDecimalEquals(result.remainingOrder!.filledQuantity, 50);
        });

        it("should match with multiple orders at different prices", () => {
            // Add multiple sell orders at different prices
            engine.processOrder(
                createSellYesOrder({
                    marketId,
                    price: 0.5,
                    quantity: 30,
                    userId: "seller1",
                }),
            );
            engine.processOrder(
                createSellYesOrder({
                    marketId,
                    price: 0.52,
                    quantity: 40,
                    userId: "seller2",
                }),
            );
            engine.processOrder(
                createSellYesOrder({
                    marketId,
                    price: 0.55,
                    quantity: 50,
                    userId: "seller3",
                }),
            );

            // Buy with high price limit
            const result = engine.processOrder(
                createBuyYesOrder({
                    marketId,
                    price: 0.6,
                    quantity: 100,
                    userId: "buyer",
                }),
            );

            expect(result.trades).toHaveLength(3);
            expectDecimalEquals(result.filledQuantity, 100); // 30 + 40 + 30

            // Should match at ascending prices (best first)
            expectDecimalEquals(result.trades[0].price, 0.5);
            expectDecimalEquals(result.trades[0].quantity, 30);

            expectDecimalEquals(result.trades[1].price, 0.52);
            expectDecimalEquals(result.trades[1].quantity, 40);

            expectDecimalEquals(result.trades[2].price, 0.55);
            expectDecimalEquals(result.trades[2].quantity, 30); // Only 30 remaining
        });

        it("should update maker order status correctly on partial fill", () => {
            const makerOrder = createSellYesOrder({
                marketId,
                orderId: "maker",
                price: 0.5,
                quantity: 100,
                userId: "seller",
            });
            engine.processOrder(makerOrder);

            // Small taker order
            engine.processOrder(
                createBuyYesOrder({
                    marketId,
                    price: 0.5,
                    quantity: 30,
                    userId: "buyer",
                }),
            );

            const updatedMaker = engine.getOrder("maker");
            expect(updatedMaker).not.toBeNull();
            expectOrderStatus(updatedMaker!, "partial");
            expectDecimalEquals(updatedMaker!.filledQuantity, 30);
        });
    });

    describe("market orders", () => {
        it("should fill market order at best available price", () => {
            // Add multiple sell orders
            engine.processOrder(
                createSellYesOrder({
                    marketId,
                    price: 0.52,
                    quantity: 100,
                    userId: "seller1",
                }),
            );
            engine.processOrder(
                createSellYesOrder({
                    marketId,
                    price: 0.5,
                    quantity: 100,
                    userId: "seller2",
                }),
            );

            // Market order should match at 0.50 (best ask)
            const result = engine.processOrder(
                createOrder({
                    marketId,
                    side: "yes",
                    action: "buy",
                    orderType: "market",
                    price: 0, // Market orders use price 0
                    quantity: 50,
                    userId: "buyer",
                }),
            );

            expect(result.trades).toHaveLength(1);
            expect(result.orderStatus).toBe("filled");
            expectDecimalEquals(result.trades[0].price, 0.5); // Best available
        });

        it("should reject market order with no liquidity", () => {
            // No orders in book
            const result = engine.processOrder(
                createOrder({
                    marketId,
                    side: "yes",
                    action: "buy",
                    orderType: "market",
                    price: 0,
                    quantity: 100,
                    userId: "buyer",
                }),
            );

            expect(result.trades).toHaveLength(0);
            expect(result.orderStatus).toBe("rejected");
            expect(result.remainingOrder).toBeNull();
        });

        it("should handle partial fill for market order", () => {
            engine.processOrder(
                createSellYesOrder({
                    marketId,
                    price: 0.5,
                    quantity: 50,
                    userId: "seller",
                }),
            );

            const result = engine.processOrder(
                createOrder({
                    marketId,
                    side: "yes",
                    action: "buy",
                    orderType: "market",
                    price: 0,
                    quantity: 100,
                    userId: "buyer",
                }),
            );

            expect(result.trades).toHaveLength(1);
            expect(result.orderStatus).toBe("partial");
            expectDecimalEquals(result.filledQuantity, 50);
            expect(result.remainingOrder).toBeNull(); // Market orders don't rest
        });
    });

    describe("self-match prevention", () => {
        it("should skip self-matching orders", () => {
            // Same user posts bid and ask
            engine.processOrder(
                createSellYesOrder({
                    marketId,
                    price: 0.5,
                    quantity: 100,
                    userId: "same-user",
                }),
            );

            const result = engine.processOrder(
                createBuyYesOrder({
                    marketId,
                    price: 0.5,
                    quantity: 100,
                    userId: "same-user",
                }),
            );

            expect(result.trades).toHaveLength(0);
            expect(result.orderStatus).toBe("open");

            // Both orders should be in book
            const book = engine.getOrderBook(marketId);
            expect(book.yes.bids).toHaveLength(1);
            expect(book.yes.asks).toHaveLength(1);
        });

        it("should match with other users but skip self", () => {
            // Two sell orders: one from self, one from other
            engine.processOrder(
                createSellYesOrder({
                    marketId,
                    price: 0.5,
                    quantity: 100,
                    userId: "self",
                }),
            );
            engine.processOrder(
                createSellYesOrder({
                    marketId,
                    price: 0.52,
                    quantity: 100,
                    userId: "other",
                }),
            );

            // Self buys - should skip own order and match with other
            const result = engine.processOrder(
                createBuyYesOrder({
                    marketId,
                    price: 0.55,
                    quantity: 100,
                    userId: "self",
                }),
            );

            expect(result.trades).toHaveLength(1);
            expectDecimalEquals(result.trades[0].price, 0.52); // Matched with "other"
        });
    });

    describe("time priority (FIFO)", () => {
        it("should match older orders first at same price", () => {
            const now = new Date();

            // Order 2 arrives first but we add it second to test FIFO
            const order1 = createSellYesOrder({
                marketId,
                orderId: "first",
                price: 0.5,
                quantity: 50,
                userId: "seller1",
                createdAt: withTimeOffset(now, 0),
            });
            const order2 = createSellYesOrder({
                marketId,
                orderId: "second",
                price: 0.5,
                quantity: 50,
                userId: "seller2",
                createdAt: withTimeOffset(now, 100),
            });

            engine.processOrder(order2);
            engine.processOrder(order1);

            // Buy should match with "first" (earlier createdAt)
            const result = engine.processOrder(
                createBuyYesOrder({
                    marketId,
                    price: 0.5,
                    quantity: 50,
                    userId: "buyer",
                }),
            );

            expect(result.trades).toHaveLength(1);
            expect(result.trades[0].sellerOrderId).toBe("first");
        });
    });

    describe("order cancellation", () => {
        it("should cancel open order", () => {
            const order = createBuyYesOrder({
                marketId,
                orderId: "cancel-me",
                price: 0.5,
                userId: "user",
            });
            engine.processOrder(order);

            const cancelled = engine.cancelOrder("cancel-me", marketId);

            expect(cancelled).not.toBeNull();
            expect(cancelled!.status).toBe("cancelled");

            // Should not be in book
            const book = engine.getOrderBook(marketId);
            expect(book.yes.bids).toHaveLength(0);
        });

        it("should return null for non-existent order", () => {
            const result = engine.cancelOrder("does-not-exist", marketId);
            expect(result).toBeNull();
        });

        it("should not cancel filled order", () => {
            // Create and fill an order
            engine.processOrder(
                createSellYesOrder({
                    marketId,
                    price: 0.5,
                    quantity: 100,
                    userId: "seller",
                }),
            );

            const order = createBuyYesOrder({
                marketId,
                orderId: "filled-order",
                price: 0.5,
                quantity: 100,
                userId: "buyer",
            });
            engine.processOrder(order);

            // Try to cancel
            const result = engine.cancelOrder("filled-order", marketId);
            expect(result).toBeNull();
        });
    });

    describe("addOrderToBook (rehydration)", () => {
        it("should add order without matching", () => {
            // Add a matching order first
            engine.processOrder(
                createSellYesOrder({
                    marketId,
                    price: 0.5,
                    quantity: 100,
                    userId: "seller",
                }),
            );

            // Add directly to book (simulating rehydration)
            const order = createBuyYesOrder({
                marketId,
                price: 0.5,
                quantity: 100,
                userId: "buyer",
                status: "open",
            });
            engine.addOrderToBook(order);

            // Both should be in book (no matching occurred)
            const book = engine.getOrderBook(marketId);
            expect(book.yes.bids).toHaveLength(1);
            expect(book.yes.asks).toHaveLength(1);
        });
    });

    describe("getOrder", () => {
        it("should retrieve order by ID", () => {
            const order = createBuyYesOrder({
                marketId,
                orderId: "find-me",
                userId: "user",
            });
            engine.processOrder(order);

            const found = engine.getOrder("find-me");
            expect(found).not.toBeNull();
            expect(found!.orderId).toBe("find-me");
        });

        it("should return null for non-existent order", () => {
            const found = engine.getOrder("not-found");
            expect(found).toBeNull();
        });
    });

    describe("getOrderBook", () => {
        it("should return empty book for unknown market", () => {
            const book = engine.getOrderBook("unknown-market");

            expect(book.marketId).toBe("unknown-market");
            expect(book.yes.bids).toHaveLength(0);
            expect(book.yes.asks).toHaveLength(0);
            expect(book.no.bids).toHaveLength(0);
            expect(book.no.asks).toHaveLength(0);
        });
    });

    describe("getActiveMarkets", () => {
        it("should return list of markets with orderbooks", () => {
            engine.processOrder(createBuyYesOrder({ marketId: "market-1" }));
            engine.processOrder(createBuyYesOrder({ marketId: "market-2" }));
            engine.processOrder(createBuyYesOrder({ marketId: "market-3" }));

            const markets = engine.getActiveMarkets();
            expect(markets).toHaveLength(3);
            expect(markets).toContain("market-1");
            expect(markets).toContain("market-2");
            expect(markets).toContain("market-3");
        });
    });

    describe("clear", () => {
        it("should remove all orders and orderbooks", () => {
            engine.processOrder(createBuyYesOrder({ marketId: "market-1" }));
            engine.processOrder(createBuyYesOrder({ marketId: "market-2" }));

            engine.clear();

            expect(engine.getActiveMarkets()).toHaveLength(0);
            expect(engine.getOrder("any")).toBeNull();
        });
    });
});
