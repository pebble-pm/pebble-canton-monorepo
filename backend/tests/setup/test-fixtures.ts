/**
 * Test fixtures factory for Pebble backend tests
 *
 * Provides reusable test data for:
 * - Orders
 * - Markets
 * - Accounts
 * - Positions
 * - Trades
 */

import Decimal from "decimal.js";
import { testId } from "./test-env";
import type { Order, OrderSide, OrderAction, OrderType, OrderStatus, Trade, Market, Position, TradingAccount } from "../../src/types";

/** Market status type */
type MarketStatus = Market["status"];

/** Account projection for tests */
interface AccountProjection extends TradingAccount {
    totalEquity: Decimal;
}

/** Position projection for tests */
interface PositionProjection extends Position {
    availableQuantity: Decimal;
}

// ============================================
// Order Fixtures
// ============================================

export interface OrderFixtureOptions {
    orderId?: string;
    marketId?: string;
    userId?: string;
    side?: OrderSide;
    action?: OrderAction;
    orderType?: OrderType;
    price?: number | string;
    quantity?: number | string;
    filledQuantity?: number | string;
    status?: OrderStatus;
    lockedAmount?: number | string;
    createdAt?: Date;
}

/**
 * Create a test order with sensible defaults
 */
export function createOrder(options: OrderFixtureOptions = {}): Order {
    const now = new Date();

    return {
        orderId: options.orderId ?? testId("order"),
        marketId: options.marketId ?? testId("market"),
        userId: options.userId ?? testId("user"),
        side: options.side ?? "yes",
        action: options.action ?? "buy",
        orderType: options.orderType ?? "limit",
        price: new Decimal(options.price ?? 0.5),
        quantity: new Decimal(options.quantity ?? 100),
        filledQuantity: new Decimal(options.filledQuantity ?? 0),
        status: options.status ?? "open",
        lockedAmount: new Decimal(options.lockedAmount ?? 50),
        createdAt: options.createdAt ?? now,
        updatedAt: now,
    };
}

/**
 * Create a buy YES order
 */
export function createBuyYesOrder(options: OrderFixtureOptions = {}): Order {
    return createOrder({
        side: "yes",
        action: "buy",
        ...options,
    });
}

/**
 * Create a buy NO order
 */
export function createBuyNoOrder(options: OrderFixtureOptions = {}): Order {
    return createOrder({
        side: "no",
        action: "buy",
        ...options,
    });
}

/**
 * Create a sell YES order
 */
export function createSellYesOrder(options: OrderFixtureOptions = {}): Order {
    return createOrder({
        side: "yes",
        action: "sell",
        ...options,
    });
}

/**
 * Create a sell NO order
 */
export function createSellNoOrder(options: OrderFixtureOptions = {}): Order {
    return createOrder({
        side: "no",
        action: "sell",
        ...options,
    });
}

// ============================================
// Trade Fixtures
// ============================================

export interface TradeFixtureOptions {
    tradeId?: string;
    marketId?: string;
    buyerId?: string;
    sellerId?: string;
    side?: OrderSide;
    price?: number | string;
    quantity?: number | string;
    tradeType?: "share_trade" | "share_creation";
    settlementStatus?: Trade["settlementStatus"];
}

/**
 * Create a test trade
 */
export function createTrade(options: TradeFixtureOptions = {}): Trade {
    return {
        tradeId: options.tradeId ?? testId("trade"),
        marketId: options.marketId ?? testId("market"),
        buyerId: options.buyerId ?? testId("buyer"),
        sellerId: options.sellerId ?? testId("seller"),
        side: options.side ?? "yes",
        price: new Decimal(options.price ?? 0.5),
        quantity: new Decimal(options.quantity ?? 100),
        buyerOrderId: testId("buyer-order"),
        sellerOrderId: testId("seller-order"),
        tradeType: options.tradeType ?? "share_trade",
        settlementId: "",
        settlementStatus: options.settlementStatus ?? "pending",
        createdAt: new Date(),
    };
}

// ============================================
// Market Fixtures
// ============================================

export interface MarketFixtureOptions {
    marketId?: string;
    question?: string;
    description?: string;
    status?: MarketStatus;
    outcome?: boolean;
    resolutionTime?: Date;
}

/**
 * Create a test market
 */
export function createMarket(options: MarketFixtureOptions = {}): Market {
    const now = new Date();
    const defaultResolutionTime = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now

    return {
        marketId: options.marketId ?? testId("market"),
        question: options.question ?? "Will this test pass?",
        description: options.description ?? "Test market for unit tests",
        resolutionTime: options.resolutionTime ?? defaultResolutionTime,
        createdAt: now,
        status: options.status ?? "open",
        outcome: options.outcome,
        yesPrice: new Decimal(0.5),
        noPrice: new Decimal(0.5),
        volume24h: new Decimal(0),
        totalVolume: new Decimal(0),
        openInterest: new Decimal(0),
        version: 0,
        contractId: options.marketId ?? testId("market-cid"),
        lastUpdated: now,
    };
}

// ============================================
// Account Fixtures
// ============================================

export interface AccountFixtureOptions {
    userId?: string;
    availableBalance?: number | string;
    lockedBalance?: number | string;
    contractId?: string;
}

/**
 * Create a test account projection
 */
export function createAccountProjection(options: AccountFixtureOptions = {}): AccountProjection {
    return {
        userId: options.userId ?? testId("user"),
        partyId: options.userId ?? testId("user"),
        accountContractId: options.contractId ?? testId("account-cid"),
        authorizationContractId: testId("auth-cid"),
        availableBalance: new Decimal(options.availableBalance ?? 1000),
        lockedBalance: new Decimal(options.lockedBalance ?? 0),
        totalEquity: new Decimal(options.availableBalance ?? 1000),
        lastUpdated: new Date(),
    };
}

// ============================================
// Position Fixtures
// ============================================

export interface PositionFixtureOptions {
    positionId?: string;
    userId?: string;
    marketId?: string;
    side?: OrderSide;
    quantity?: number | string;
    lockedQuantity?: number | string;
    avgCostBasis?: number | string;
}

/**
 * Create a test position projection
 */
export function createPositionProjection(options: PositionFixtureOptions = {}): PositionProjection {
    const quantity = new Decimal(options.quantity ?? 100);
    const lockedQuantity = new Decimal(options.lockedQuantity ?? 0);
    const avgCostBasis = new Decimal(options.avgCostBasis ?? 0.5);

    return {
        positionId: options.positionId ?? testId("position-cid"),
        userId: options.userId ?? testId("user"),
        marketId: options.marketId ?? testId("market"),
        side: options.side ?? "yes",
        quantity,
        lockedQuantity,
        availableQuantity: quantity.minus(lockedQuantity),
        avgCostBasis,
        currentValue: quantity.mul(0.5), // Assume 50% price
        unrealizedPnL: quantity.mul(0.5).minus(quantity.mul(avgCostBasis)),
        lastUpdated: new Date(),
        isArchived: false,
    };
}

// ============================================
// Test Scenarios
// ============================================

/**
 * Create a complete test scenario with multiple users and orders
 */
export interface TestScenario {
    market: Market;
    alice: {
        userId: string;
        account: AccountProjection;
    };
    bob: {
        userId: string;
        account: AccountProjection;
    };
    charlie: {
        userId: string;
        account: AccountProjection;
    };
}

export function createTestScenario(): TestScenario {
    const marketId = testId("market");

    const aliceUserId = "Alice";
    const bobUserId = "Bob";
    const charlieUserId = "Charlie";

    return {
        market: createMarket({ marketId }),
        alice: {
            userId: aliceUserId,
            account: createAccountProjection({
                userId: aliceUserId,
                availableBalance: 1000,
            }),
        },
        bob: {
            userId: bobUserId,
            account: createAccountProjection({
                userId: bobUserId,
                availableBalance: 1000,
            }),
        },
        charlie: {
            userId: charlieUserId,
            account: createAccountProjection({
                userId: charlieUserId,
                availableBalance: 1000,
            }),
        },
    };
}

// ============================================
// Order Book Scenarios
// ============================================

/**
 * Create a scenario with multiple orders at different price levels
 */
export interface OrderBookScenario {
    marketId: string;
    yesBids: Order[];
    yesAsks: Order[];
    noBids: Order[];
    noAsks: Order[];
}

export function createOrderBookScenario(): OrderBookScenario {
    const marketId = testId("market");

    // Create orders at different price levels
    const yesBids = [
        createBuyYesOrder({ marketId, price: 0.48, userId: "User1", quantity: 100 }),
        createBuyYesOrder({ marketId, price: 0.47, userId: "User2", quantity: 200 }),
        createBuyYesOrder({ marketId, price: 0.46, userId: "User3", quantity: 150 }),
    ];

    const yesAsks = [
        createSellYesOrder({ marketId, price: 0.52, userId: "User4", quantity: 100 }),
        createSellYesOrder({ marketId, price: 0.53, userId: "User5", quantity: 200 }),
        createSellYesOrder({ marketId, price: 0.54, userId: "User6", quantity: 150 }),
    ];

    const noBids = [
        createBuyNoOrder({ marketId, price: 0.52, userId: "User7", quantity: 100 }),
        createBuyNoOrder({ marketId, price: 0.51, userId: "User8", quantity: 200 }),
    ];

    const noAsks = [
        createSellNoOrder({ marketId, price: 0.54, userId: "User9", quantity: 100 }),
        createSellNoOrder({ marketId, price: 0.55, userId: "User10", quantity: 200 }),
    ];

    return { marketId, yesBids, yesAsks, noBids, noAsks };
}
