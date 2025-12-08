/**
 * Unit tests for OrderService
 *
 * Tests:
 * - Order validation
 * - Idempotency handling
 * - Order placement (with mocked Canton)
 * - Order cancellation
 * - Saga compensation
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import Decimal from "decimal.js";
import { OrderService, OrderValidationError, OrderNotFoundError } from "../../../src/services/order.service";
import { MatchingEngine, OrderbookPersistence } from "../../../src/matching";
import type { PlaceOrderRequest, Order, Market } from "../../../src/types";
import { testId } from "../../setup/test-env";
import { createAccountProjection, createMarket, createPositionProjection } from "../../setup/test-fixtures";

// ============================================
// Mock Repositories
// ============================================

function createMockOrderRepo() {
    const orders = new Map<string, Order>();

    return {
        create: mock((order: Order) => {
            orders.set(order.orderId, order);
        }),
        getById: mock((orderId: string) => orders.get(orderId) ?? null),
        getByUser: mock((userId: string) => Array.from(orders.values()).filter((o) => o.userId === userId)),
        getOpenOrdersByUser: mock((userId: string, marketId?: string) =>
            Array.from(orders.values()).filter(
                (o) =>
                    o.userId === userId &&
                    (o.status === "open" || o.status === "partial") &&
                    (!marketId || o.marketId === marketId),
            ),
        ),
        getByIdempotencyKey: mock((_userId: string, _key: string) => null as Order | null),
        updateFilled: mock((orderId: string, filledQuantity: Decimal, status: Order["status"]) => {
            const order = orders.get(orderId);
            if (order) {
                order.filledQuantity = filledQuantity;
                order.status = status;
            }
        }),
        updateStatus: mock((orderId: string, status: Order["status"]) => {
            const order = orders.get(orderId);
            if (order) {
                order.status = status;
            }
        }),
        // Expose for testing
        _orders: orders,
    };
}

function createMockTradeRepo() {
    return {
        create: mock(() => {}),
        getById: mock(() => null),
        getPendingTrades: mock(() => []),
        updateSettlementStatus: mock(() => {}),
    };
}

function createMockAccountRepo() {
    const accounts = new Map<string, ReturnType<typeof createAccountProjection>>();

    return {
        getById: mock((userId: string) => accounts.get(userId) ?? null),
        lockFunds: mock((userId: string, amount: Decimal) => {
            const account = accounts.get(userId);
            if (account) {
                account.availableBalance = account.availableBalance.minus(amount);
                account.lockedBalance = account.lockedBalance.plus(amount);
            }
        }),
        unlockFunds: mock((userId: string, amount: Decimal) => {
            const account = accounts.get(userId);
            if (account) {
                account.availableBalance = account.availableBalance.plus(amount);
                account.lockedBalance = account.lockedBalance.minus(amount);
            }
        }),
        // Test helper
        _set: (userId: string, account: ReturnType<typeof createAccountProjection>) => {
            accounts.set(userId, account);
        },
        _accounts: accounts,
    };
}

function createMockPositionRepo() {
    const positions = new Map<string, ReturnType<typeof createPositionProjection>>();

    return {
        getByUserMarketSide: mock((userId: string, marketId: string, side: "yes" | "no") => {
            const key = `${userId}:${marketId}:${side}`;
            return positions.get(key) ?? null;
        }),
        lockShares: mock((positionId: string, quantity: Decimal) => {
            for (const pos of positions.values()) {
                if (pos.positionId === positionId) {
                    pos.lockedQuantity = pos.lockedQuantity.plus(quantity);
                }
            }
        }),
        unlockShares: mock((positionId: string, quantity: Decimal) => {
            for (const pos of positions.values()) {
                if (pos.positionId === positionId) {
                    pos.lockedQuantity = pos.lockedQuantity.minus(quantity);
                }
            }
        }),
        // Test helper
        _set: (
            userId: string,
            marketId: string,
            side: "yes" | "no",
            position: ReturnType<typeof createPositionProjection>,
        ) => {
            const key = `${userId}:${marketId}:${side}`;
            positions.set(key, position);
        },
        _positions: positions,
    };
}

function createMockMarketRepo() {
    const markets = new Map<string, Market>();

    return {
        getById: mock((marketId: string) => markets.get(marketId) ?? null),
        updatePricing: mock(() => {}),
        updateStatus: mock(() => {}),
        // Test helper
        _set: (marketId: string, market: Market) => {
            markets.set(marketId, market);
        },
        _markets: markets,
    };
}

function createMockSettlementRepo() {
    return {
        createBatch: mock(() => {}),
        getBatchById: mock(() => null),
        updateBatchStatus: mock(() => {}),
        setBatchCantonTxId: mock(() => {}),
        getBatchesByStatus: mock(() => []),
        incrementBatchRetry: mock(() => {}),
        createEvent: mock(() => {}),
        logCompensationFailure: mock(() => {}),
    };
}

function createMockPersistence() {
    return {
        rehydrateOrderbook: mock(() => ({ restoredCount: 0 })),
        persistOrder: mock(() => {}),
        removeOrder: mock(() => {}),
    } as unknown as OrderbookPersistence;
}

// ============================================
// Tests
// ============================================

describe("OrderService", () => {
    let orderService: OrderService;
    let matchingEngine: MatchingEngine;
    let orderRepo: ReturnType<typeof createMockOrderRepo>;
    let tradeRepo: ReturnType<typeof createMockTradeRepo>;
    let accountRepo: ReturnType<typeof createMockAccountRepo>;
    let positionRepo: ReturnType<typeof createMockPositionRepo>;
    let marketRepo: ReturnType<typeof createMockMarketRepo>;
    let settlementRepo: ReturnType<typeof createMockSettlementRepo>;
    let persistence: ReturnType<typeof createMockPersistence>;

    const pebbleAdmin = "PebbleAdmin";
    const marketId = "test-market";
    const aliceId = "Alice";
    const bobId = "Bob";

    beforeEach(() => {
        matchingEngine = new MatchingEngine();
        orderRepo = createMockOrderRepo();
        tradeRepo = createMockTradeRepo();
        accountRepo = createMockAccountRepo();
        positionRepo = createMockPositionRepo();
        marketRepo = createMockMarketRepo();
        settlementRepo = createMockSettlementRepo();
        persistence = createMockPersistence();

        // Set up default test data
        marketRepo._set(marketId, createMarket({ marketId, status: "open" }));
        accountRepo._set(aliceId, createAccountProjection({ userId: aliceId, availableBalance: 1000 }));
        accountRepo._set(bobId, createAccountProjection({ userId: bobId, availableBalance: 1000 }));

        orderService = new OrderService(
            null, // Canton client (offline mode)
            matchingEngine,
            persistence,
            orderRepo as never,
            tradeRepo as never,
            accountRepo as never,
            positionRepo as never,
            marketRepo as never,
            settlementRepo as never,
            { pebbleAdminParty: pebbleAdmin },
        );
    });

    describe("validation", () => {
        it("should reject orders with invalid price (too low)", async () => {
            const request: PlaceOrderRequest = {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.001, // Below 0.01
                quantity: 100,
            };

            await expect(orderService.placeOrder(aliceId, request)).rejects.toThrow(OrderValidationError);
        });

        it("should reject orders with invalid price (too high)", async () => {
            const request: PlaceOrderRequest = {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.999, // Above 0.99
                quantity: 100,
            };

            await expect(orderService.placeOrder(aliceId, request)).rejects.toThrow(OrderValidationError);
        });

        it("should reject orders with invalid quantity", async () => {
            const request: PlaceOrderRequest = {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.5,
                quantity: 0, // Invalid
            };

            await expect(orderService.placeOrder(aliceId, request)).rejects.toThrow(OrderValidationError);
        });

        it("should reject orders for non-existent market", async () => {
            const request: PlaceOrderRequest = {
                marketId: "non-existent",
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.5,
                quantity: 100,
            };

            await expect(orderService.placeOrder(aliceId, request)).rejects.toThrow(OrderValidationError);
        });

        it("should reject orders for closed market", async () => {
            marketRepo._set("closed-market", createMarket({ marketId: "closed-market", status: "closed" }));

            const request: PlaceOrderRequest = {
                marketId: "closed-market",
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.5,
                quantity: 100,
            };

            await expect(orderService.placeOrder(aliceId, request)).rejects.toThrow(OrderValidationError);
        });

        it("should reject orders for non-existent account", async () => {
            const request: PlaceOrderRequest = {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.5,
                quantity: 100,
            };

            await expect(orderService.placeOrder("UnknownUser", request)).rejects.toThrow(OrderValidationError);
        });

        it("should reject orders with insufficient balance", async () => {
            accountRepo._set(aliceId, createAccountProjection({ userId: aliceId, availableBalance: 10 }));

            const request: PlaceOrderRequest = {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.5,
                quantity: 100, // Needs 50, but only has 10
            };

            await expect(orderService.placeOrder(aliceId, request)).rejects.toThrow(OrderValidationError);
        });

        it("should reject sell orders without position", async () => {
            const request: PlaceOrderRequest = {
                marketId,
                side: "yes",
                action: "sell",
                orderType: "limit",
                price: 0.6,
                quantity: 100,
            };

            await expect(orderService.placeOrder(aliceId, request)).rejects.toThrow(OrderValidationError);
        });

        it("should reject sell orders with insufficient position", async () => {
            positionRepo._set(
                aliceId,
                marketId,
                "yes",
                createPositionProjection({
                    userId: aliceId,
                    marketId,
                    side: "yes",
                    quantity: 50, // Only 50 shares
                    lockedQuantity: 0,
                }),
            );

            const request: PlaceOrderRequest = {
                marketId,
                side: "yes",
                action: "sell",
                orderType: "limit",
                price: 0.6,
                quantity: 100, // Trying to sell 100
            };

            await expect(orderService.placeOrder(aliceId, request)).rejects.toThrow(OrderValidationError);
        });
    });

    describe("order placement", () => {
        it("should place a buy order successfully", async () => {
            const request: PlaceOrderRequest = {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.5,
                quantity: 100,
            };

            const result = await orderService.placeOrder(aliceId, request);

            expect(result.orderId).toBeDefined();
            expect(result.status).toBe("open"); // No matching order
            expect(result.filledQuantity.toNumber()).toBe(0);
            expect(result.remainingQuantity.toNumber()).toBe(100);
            expect(result.trades).toHaveLength(0);

            // Order should be saved
            expect(orderRepo.create).toHaveBeenCalled();
        });

        it("should match orders and create trades", async () => {
            // First place a sell order
            positionRepo._set(
                bobId,
                marketId,
                "yes",
                createPositionProjection({
                    userId: bobId,
                    marketId,
                    side: "yes",
                    quantity: 100,
                    lockedQuantity: 0,
                }),
            );

            const sellRequest: PlaceOrderRequest = {
                marketId,
                side: "yes",
                action: "sell",
                orderType: "limit",
                price: 0.5,
                quantity: 100,
            };
            await orderService.placeOrder(bobId, sellRequest);

            // Then place a matching buy order
            const buyRequest: PlaceOrderRequest = {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.5,
                quantity: 100,
            };
            const result = await orderService.placeOrder(aliceId, buyRequest);

            expect(result.status).toBe("filled");
            expect(result.filledQuantity.toNumber()).toBe(100);
            expect(result.trades).toHaveLength(1);
            expect(result.trades[0].quantity.toNumber()).toBe(100);
        });

        it("should handle partial fills", async () => {
            // Sell only 50 shares
            positionRepo._set(
                bobId,
                marketId,
                "yes",
                createPositionProjection({
                    userId: bobId,
                    marketId,
                    side: "yes",
                    quantity: 50,
                    lockedQuantity: 0,
                }),
            );

            const sellRequest: PlaceOrderRequest = {
                marketId,
                side: "yes",
                action: "sell",
                orderType: "limit",
                price: 0.5,
                quantity: 50,
            };
            await orderService.placeOrder(bobId, sellRequest);

            // Try to buy 100
            const buyRequest: PlaceOrderRequest = {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.5,
                quantity: 100,
            };
            const result = await orderService.placeOrder(aliceId, buyRequest);

            expect(result.status).toBe("partial");
            expect(result.filledQuantity.toNumber()).toBe(50);
            expect(result.remainingQuantity.toNumber()).toBe(50);
        });

        it("should lock funds for buy orders", async () => {
            const request: PlaceOrderRequest = {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.5,
                quantity: 100,
            };
            await orderService.placeOrder(aliceId, request);

            expect(accountRepo.lockFunds).toHaveBeenCalledWith(aliceId, expect.any(Decimal));
        });

        it("should lock position for sell orders", async () => {
            positionRepo._set(
                aliceId,
                marketId,
                "yes",
                createPositionProjection({
                    userId: aliceId,
                    marketId,
                    side: "yes",
                    quantity: 100,
                    lockedQuantity: 0,
                }),
            );

            const request: PlaceOrderRequest = {
                marketId,
                side: "yes",
                action: "sell",
                orderType: "limit",
                price: 0.6,
                quantity: 50,
            };
            await orderService.placeOrder(aliceId, request);

            expect(positionRepo.lockShares).toHaveBeenCalled();
        });
    });

    describe("idempotency", () => {
        it("should return cached response for duplicate idempotency key", async () => {
            const idempotencyKey = testId("idempotency");

            // First request
            const request: PlaceOrderRequest = {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.5,
                quantity: 100,
            };
            const result1 = await orderService.placeOrder(aliceId, request, idempotencyKey);

            // Mock the repo to return the order for the idempotency key
            orderRepo.getByIdempotencyKey.mockReturnValue({
                orderId: result1.orderId,
                marketId,
                userId: aliceId,
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
            } as Order);

            // Second request with same key
            const result2 = await orderService.placeOrder(aliceId, request, idempotencyKey);

            expect(result2.orderId).toBe(result1.orderId);
            expect(result2.idempotencyKey).toBe(idempotencyKey);
        });
    });

    describe("order cancellation", () => {
        it("should cancel an open order", async () => {
            // Place an order
            const request: PlaceOrderRequest = {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.4, // Won't match
                quantity: 100,
            };
            const placeResult = await orderService.placeOrder(aliceId, request);

            // Cancel it
            const cancelled = await orderService.cancelOrder(aliceId, placeResult.orderId);

            expect(cancelled.status).toBe("cancelled");
            expect(orderRepo.updateStatus).toHaveBeenCalledWith(placeResult.orderId, "cancelled");
        });

        it("should not allow cancelling another user's order", async () => {
            // Place an order as Alice
            const request: PlaceOrderRequest = {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.4,
                quantity: 100,
            };
            const placeResult = await orderService.placeOrder(aliceId, request);

            // Try to cancel as Bob
            await expect(orderService.cancelOrder(bobId, placeResult.orderId)).rejects.toThrow(OrderValidationError);
        });

        it("should throw OrderNotFoundError for non-existent order", async () => {
            await expect(orderService.cancelOrder(aliceId, "non-existent-order")).rejects.toThrow(OrderNotFoundError);
        });

        it("should unlock funds when cancelling buy order", async () => {
            const request: PlaceOrderRequest = {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.5,
                quantity: 100,
            };
            const placeResult = await orderService.placeOrder(aliceId, request);

            await orderService.cancelOrder(aliceId, placeResult.orderId);

            expect(accountRepo.unlockFunds).toHaveBeenCalled();
        });

        it("should unlock position when cancelling sell order", async () => {
            positionRepo._set(
                aliceId,
                marketId,
                "yes",
                createPositionProjection({
                    userId: aliceId,
                    marketId,
                    side: "yes",
                    quantity: 100,
                    lockedQuantity: 0,
                }),
            );

            const request: PlaceOrderRequest = {
                marketId,
                side: "yes",
                action: "sell",
                orderType: "limit",
                price: 0.6,
                quantity: 50,
            };
            const placeResult = await orderService.placeOrder(aliceId, request);

            await orderService.cancelOrder(aliceId, placeResult.orderId);

            expect(positionRepo.unlockShares).toHaveBeenCalled();
        });
    });

    describe("getOrdersByUser", () => {
        it("should return all orders for a user", async () => {
            // Place multiple orders
            await orderService.placeOrder(aliceId, {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.4,
                quantity: 50,
            });
            await orderService.placeOrder(aliceId, {
                marketId,
                side: "no",
                action: "buy",
                orderType: "limit",
                price: 0.4,
                quantity: 50,
            });

            const orders = orderService.getOrdersByUser(aliceId);

            expect(orders).toHaveLength(2);
        });

        it("should filter by marketId", async () => {
            // Set up another market
            const otherMarketId = "other-market";
            marketRepo._set(otherMarketId, createMarket({ marketId: otherMarketId, status: "open" }));

            await orderService.placeOrder(aliceId, {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.4,
                quantity: 50,
            });
            await orderService.placeOrder(aliceId, {
                marketId: otherMarketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.4,
                quantity: 50,
            });

            const orders = orderService.getOrdersByUser(aliceId, marketId);

            expect(orders).toHaveLength(1);
            expect(orders[0].marketId).toBe(marketId);
        });
    });

    describe("getOpenOrdersByUser", () => {
        it("should return only open orders", async () => {
            // Place an order that will be filled
            positionRepo._set(
                bobId,
                marketId,
                "yes",
                createPositionProjection({
                    userId: bobId,
                    marketId,
                    side: "yes",
                    quantity: 100,
                    lockedQuantity: 0,
                }),
            );

            await orderService.placeOrder(bobId, {
                marketId,
                side: "yes",
                action: "sell",
                orderType: "limit",
                price: 0.5,
                quantity: 100,
            });

            // This will be filled
            await orderService.placeOrder(aliceId, {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.5,
                quantity: 100,
            });

            // This will stay open
            await orderService.placeOrder(aliceId, {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.3, // Won't match
                quantity: 50,
            });

            const openOrders = orderService.getOpenOrdersByUser(aliceId);

            expect(openOrders).toHaveLength(1);
            expect(openOrders[0].price.toNumber()).toBe(0.3);
        });
    });

    describe("initialization", () => {
        it("should call persistence.rehydrateOrderbook on initialize", () => {
            orderService.initialize();

            expect(persistence.rehydrateOrderbook).toHaveBeenCalledWith(matchingEngine);
        });
    });
});
