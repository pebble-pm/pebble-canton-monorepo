/**
 * Order types for the off-chain matching engine
 */

import type Decimal from "decimal.js";

/** Order side - which outcome to trade */
export type OrderSide = "yes" | "no";

/** Order action - buy or sell shares */
export type OrderAction = "buy" | "sell";

/** Order type - limit or market */
export type OrderType = "limit" | "market";

/** Order status lifecycle */
export type OrderStatus =
    | "pending" // Initial state, being processed
    | "open" // Resting in orderbook
    | "partial" // Partially filled, remainder in orderbook
    | "filled" // Completely filled
    | "cancelled" // User cancelled
    | "rejected"; // System rejected (insufficient balance, etc.)

/** Full order entity */
export interface Order {
    orderId: string;
    marketId: string;
    userId: string; // Party ID on Canton
    side: OrderSide;
    action: OrderAction;
    orderType: OrderType;
    price: Decimal; // 0.01 to 0.99 for limit, 0 for market
    quantity: Decimal;
    filledQuantity: Decimal;
    status: OrderStatus;
    lockedAmount: Decimal; // Amount locked on Canton
    cantonLockTxId?: string; // Transaction ID of lock operation
    idempotencyKey?: string; // For duplicate prevention
    createdAt: Date;
    updatedAt: Date;
}

/** Request to place an order */
export interface PlaceOrderRequest {
    marketId: string;
    side: OrderSide;
    action: OrderAction;
    orderType: OrderType;
    price?: number; // Required for limit orders (0.01-0.99)
    quantity: number;
}

/** Trade execution from matching */
export interface TradeExecution {
    tradeId: string;
    price: Decimal;
    quantity: Decimal;
    counterpartyOrderId: string;
}

/** Response from placing an order */
export interface PlaceOrderResponse {
    orderId: string;
    status: OrderStatus;
    filledQuantity: Decimal;
    remainingQuantity: Decimal;
    trades: TradeExecution[];
    lockedAmount: Decimal;
    idempotencyKey?: string;
}

/** Orderbook snapshot for a market */
export interface OrderBook {
    marketId: string;
    yes: {
        bids: OrderBookLevel[]; // Buy YES, sorted desc by price
        asks: OrderBookLevel[]; // Sell YES, sorted asc by price
    };
    no: {
        bids: OrderBookLevel[];
        asks: OrderBookLevel[];
    };
    lastUpdated: Date;
}

/** Aggregated orderbook level */
export interface OrderBookLevel {
    price: Decimal;
    quantity: Decimal;
    orderCount: number;
}

/** Order update for WebSocket notifications */
export interface OrderUpdate {
    orderId: string;
    status: OrderStatus;
    filledQuantity: Decimal;
    remainingQuantity: Decimal;
    timestamp: Date;
}
