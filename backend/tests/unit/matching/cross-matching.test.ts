/**
 * Unit tests for binary market cross-matching
 *
 * In binary prediction markets:
 * - BUY YES at price P can match with BUY NO at price (1-P)
 * - This creates new shares (ShareCreation) rather than trading existing ones
 *
 * Example:
 * - Alice BUY YES @ 0.40 (willing to pay 40 cents for a YES share)
 * - Bob BUY NO @ 0.60 (willing to pay 60 cents for a NO share)
 * - Together they pay $1.00, which creates 1 YES and 1 NO share
 * - Alice gets YES, Bob gets NO
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { MatchingEngine } from "../../../src/matching/engine";
import { createBuyYesOrder, createBuyNoOrder, createSellYesOrder, createSellNoOrder } from "../../setup/test-fixtures";
import { expectDecimalEquals } from "../../setup/test-helpers";

describe("Cross-Matching (Binary Market)", () => {
    let engine: MatchingEngine;
    const marketId = "test-market";

    beforeEach(() => {
        engine = new MatchingEngine();
    });

    describe("BUY YES vs BUY NO", () => {
        it("should create shares when YES+NO prices sum to 1", () => {
            // Bob wants NO at 0.60
            engine.processOrder(
                createBuyNoOrder({
                    marketId,
                    price: 0.6,
                    quantity: 100,
                    userId: "Bob",
                }),
            );

            // Alice wants YES at 0.40 - should cross-match
            const result = engine.processOrder(
                createBuyYesOrder({
                    marketId,
                    price: 0.4,
                    quantity: 100,
                    userId: "Alice",
                }),
            );

            expect(result.trades).toHaveLength(1);
            expect(result.orderStatus).toBe("filled");

            // Trade should be share_creation
            const trade = result.trades[0];
            expect(trade.tradeType).toBe("share_creation");

            // In share_creation: YES buyer is "buyer", NO buyer is "seller"
            expect(trade.buyerId).toBe("Alice");
            expect(trade.sellerId).toBe("Bob");
            expect(trade.side).toBe("yes");
            expectDecimalEquals(trade.price, 0.4); // YES price
            expectDecimalEquals(trade.quantity, 100);
        });

        it("should match when prices overlap (sum > 1)", () => {
            // Bob wants NO at 0.70 (effectively selling YES at 0.30)
            engine.processOrder(
                createBuyNoOrder({
                    marketId,
                    price: 0.7,
                    quantity: 100,
                    userId: "Bob",
                }),
            );

            // Alice wants YES at 0.40 - prices overlap!
            // Bob's effective YES price = 1 - 0.70 = 0.30
            // Alice willing to pay 0.40 >= 0.30, so match at 0.30
            const result = engine.processOrder(
                createBuyYesOrder({
                    marketId,
                    price: 0.4,
                    quantity: 100,
                    userId: "Alice",
                }),
            );

            expect(result.trades).toHaveLength(1);
            expect(result.orderStatus).toBe("filled");
            expect(result.trades[0].tradeType).toBe("share_creation");

            // Price improvement: Alice gets YES at 0.30 (maker's effective price)
            expectDecimalEquals(result.trades[0].price, 0.3);
        });

        it("should not match when prices don't overlap (sum < 1)", () => {
            // Bob wants NO at 0.40 (effectively selling YES at 0.60)
            engine.processOrder(
                createBuyNoOrder({
                    marketId,
                    price: 0.4,
                    quantity: 100,
                    userId: "Bob",
                }),
            );

            // Alice wants YES at 0.50 - prices don't overlap
            // Bob's effective YES price = 0.60, Alice only willing to pay 0.50
            const result = engine.processOrder(
                createBuyYesOrder({
                    marketId,
                    price: 0.5,
                    quantity: 100,
                    userId: "Alice",
                }),
            );

            expect(result.trades).toHaveLength(0);
            expect(result.orderStatus).toBe("open");
        });
    });

    describe("Priority: Direct vs Cross-Match", () => {
        it("should prefer direct match (sell order) over cross-match", () => {
            // Seller has YES shares at 0.40
            engine.processOrder(
                createSellYesOrder({
                    marketId,
                    price: 0.4,
                    quantity: 100,
                    userId: "Seller",
                }),
            );

            // Bob has BUY NO at 0.60 (effective YES at 0.40) - same price
            engine.processOrder(
                createBuyNoOrder({
                    marketId,
                    price: 0.6,
                    quantity: 100,
                    userId: "Bob",
                }),
            );

            // Alice buys YES at 0.40
            const result = engine.processOrder(
                createBuyYesOrder({
                    marketId,
                    price: 0.4,
                    quantity: 100,
                    userId: "Alice",
                }),
            );

            expect(result.trades).toHaveLength(1);

            // Should match with Seller (direct match) due to sorting
            // Both have same effective price, but sell orders come before cross-matches
            expect(result.trades[0].tradeType).toBe("share_trade");
            expect(result.trades[0].sellerId).toBe("Seller");
        });

        it("should cross-match when direct match not available", () => {
            // Only Bob's NO order available (no direct YES seller)
            engine.processOrder(
                createBuyNoOrder({
                    marketId,
                    price: 0.6,
                    quantity: 100,
                    userId: "Bob",
                }),
            );

            // Alice buys YES
            const result = engine.processOrder(
                createBuyYesOrder({
                    marketId,
                    price: 0.4,
                    quantity: 100,
                    userId: "Alice",
                }),
            );

            expect(result.trades).toHaveLength(1);
            expect(result.trades[0].tradeType).toBe("share_creation");
        });
    });

    describe("BUY NO vs BUY YES", () => {
        it("should cross-match when NO buyer is taker", () => {
            // Alice has BUY YES at 0.40
            engine.processOrder(
                createBuyYesOrder({
                    marketId,
                    price: 0.4,
                    quantity: 100,
                    userId: "Alice",
                }),
            );

            // Bob buys NO at 0.60 - should cross-match
            const result = engine.processOrder(
                createBuyNoOrder({
                    marketId,
                    price: 0.6,
                    quantity: 100,
                    userId: "Bob",
                }),
            );

            expect(result.trades).toHaveLength(1);
            expect(result.orderStatus).toBe("filled");

            const trade = result.trades[0];
            expect(trade.tradeType).toBe("share_creation");

            // YES buyer (Alice) is always "buyer" in share_creation
            expect(trade.buyerId).toBe("Alice");
            expect(trade.sellerId).toBe("Bob");
            expect(trade.side).toBe("yes");

            // Price should be Alice's YES price
            expectDecimalEquals(trade.price, 0.4);
        });
    });

    describe("SELL vs SELL cross-matching", () => {
        it("should cross-match SELL YES vs SELL NO when prices overlap", () => {
            // This is less common but valid:
            // SELL YES at 0.40 matches SELL NO at 0.60
            // Combined, someone could buy YES at 0.40 and NO at 0.60

            // Charlie sells NO at 0.60
            engine.processOrder(
                createSellNoOrder({
                    marketId,
                    price: 0.6,
                    quantity: 100,
                    userId: "Charlie",
                }),
            );

            // Dave sells YES at 0.40 (effective for NO buyer at 1-0.40=0.60)
            const result = engine.processOrder(
                createSellYesOrder({
                    marketId,
                    price: 0.4,
                    quantity: 100,
                    userId: "Dave",
                }),
            );

            // Sells should cross-match (both are effectively offering to close out positions)
            expect(result.trades).toHaveLength(1);
            expect(result.trades[0].tradeType).toBe("share_creation");
        });
    });

    describe("Partial cross-matching", () => {
        it("should partially fill with cross-match", () => {
            // Bob wants NO at 0.60, but only 50 shares
            engine.processOrder(
                createBuyNoOrder({
                    marketId,
                    price: 0.6,
                    quantity: 50,
                    userId: "Bob",
                }),
            );

            // Alice wants 100 YES shares
            const result = engine.processOrder(
                createBuyYesOrder({
                    marketId,
                    price: 0.4,
                    quantity: 100,
                    userId: "Alice",
                }),
            );

            expect(result.trades).toHaveLength(1);
            expect(result.orderStatus).toBe("partial");
            expectDecimalEquals(result.filledQuantity, 50);
            expect(result.remainingOrder).not.toBeNull();
        });

        it("should match with multiple cross-matches", () => {
            // Multiple NO buyers
            engine.processOrder(
                createBuyNoOrder({
                    marketId,
                    price: 0.6,
                    quantity: 30,
                    userId: "Bob1",
                }),
            );
            engine.processOrder(
                createBuyNoOrder({
                    marketId,
                    price: 0.62,
                    quantity: 40,
                    userId: "Bob2",
                }),
            );
            engine.processOrder(
                createBuyNoOrder({
                    marketId,
                    price: 0.58,
                    quantity: 50,
                    userId: "Bob3",
                }),
            );

            // Alice wants 100 YES
            const result = engine.processOrder(
                createBuyYesOrder({
                    marketId,
                    price: 0.45, // Willing to pay up to 0.45
                    quantity: 100,
                    userId: "Alice",
                }),
            );

            // Should match with Bob2 (effective 0.38) and Bob1 (effective 0.40)
            // Bob3 (effective 0.42) also matches but may not be needed
            expect(result.trades.length).toBeGreaterThan(0);
            expect(result.orderStatus).toBe("filled");
        });
    });

    describe("Mixed direct and cross-match", () => {
        it("should combine direct match and cross-match to fill order", () => {
            // Direct seller at 0.45
            engine.processOrder(
                createSellYesOrder({
                    marketId,
                    price: 0.45,
                    quantity: 50,
                    userId: "Seller",
                }),
            );

            // Cross-match candidate at 0.40 effective
            engine.processOrder(
                createBuyNoOrder({
                    marketId,
                    price: 0.6,
                    quantity: 50,
                    userId: "NoBuyer",
                }),
            );

            // Alice wants 100 YES at 0.50
            const result = engine.processOrder(
                createBuyYesOrder({
                    marketId,
                    price: 0.5,
                    quantity: 100,
                    userId: "Alice",
                }),
            );

            expect(result.trades).toHaveLength(2);
            expect(result.orderStatus).toBe("filled");
            expectDecimalEquals(result.filledQuantity, 100);

            // Should have one share_trade and one share_creation
            const tradeTypes = result.trades.map((t) => t.tradeType);
            expect(tradeTypes).toContain("share_trade");
            expect(tradeTypes).toContain("share_creation");
        });
    });

    describe("Price priority in cross-matching", () => {
        it("should match best cross-price first", () => {
            // Multiple NO buyers at different prices
            engine.processOrder(
                createBuyNoOrder({
                    marketId,
                    price: 0.65,
                    quantity: 100,
                    userId: "Best", // Effective YES price = 0.35
                }),
            );
            engine.processOrder(
                createBuyNoOrder({
                    marketId,
                    price: 0.6,
                    quantity: 100,
                    userId: "Worst", // Effective YES price = 0.40
                }),
            );

            // Alice buys YES
            const result = engine.processOrder(
                createBuyYesOrder({
                    marketId,
                    price: 0.45,
                    quantity: 100,
                    userId: "Alice",
                }),
            );

            expect(result.trades).toHaveLength(1);

            // Should match with "Best" (lower effective price = 0.35)
            expect(result.trades[0].sellerId).toBe("Best");
            expectDecimalEquals(result.trades[0].price, 0.35);
        });
    });

    describe("Edge cases", () => {
        it("should handle cross-match at exactly 0.50/0.50", () => {
            engine.processOrder(
                createBuyNoOrder({
                    marketId,
                    price: 0.5,
                    quantity: 100,
                    userId: "Bob",
                }),
            );

            const result = engine.processOrder(
                createBuyYesOrder({
                    marketId,
                    price: 0.5,
                    quantity: 100,
                    userId: "Alice",
                }),
            );

            expect(result.trades).toHaveLength(1);
            expect(result.trades[0].tradeType).toBe("share_creation");
            expectDecimalEquals(result.trades[0].price, 0.5);
        });

        it("should handle asymmetric prices near boundaries", () => {
            // Bob pays 0.99 for NO (very confident it's NO)
            engine.processOrder(
                createBuyNoOrder({
                    marketId,
                    price: 0.99,
                    quantity: 100,
                    userId: "Bob",
                }),
            );

            // Alice pays 0.01 for YES (very cheap)
            const result = engine.processOrder(
                createBuyYesOrder({
                    marketId,
                    price: 0.01,
                    quantity: 100,
                    userId: "Alice",
                }),
            );

            expect(result.trades).toHaveLength(1);
            expect(result.trades[0].tradeType).toBe("share_creation");
            expectDecimalEquals(result.trades[0].price, 0.01);
        });

        it("should prevent self cross-match", () => {
            // Same user posts both sides
            engine.processOrder(
                createBuyNoOrder({
                    marketId,
                    price: 0.6,
                    quantity: 100,
                    userId: "SameUser",
                }),
            );

            const result = engine.processOrder(
                createBuyYesOrder({
                    marketId,
                    price: 0.4,
                    quantity: 100,
                    userId: "SameUser",
                }),
            );

            // Should not self-match
            expect(result.trades).toHaveLength(0);
            expect(result.orderStatus).toBe("open");
        });
    });
});
