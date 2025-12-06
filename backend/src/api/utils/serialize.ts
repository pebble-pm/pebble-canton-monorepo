/**
 * Serialization utilities for converting domain types to API response types
 *
 * Converts Decimal.js values to strings for JSON serialization
 */

import type { Market, Order, Position, TradingAccount, Trade, OrderBook, OrderBookLevel, TradePublic } from "../../types";
import type {
    MarketResponse,
    OrderResponse,
    PositionResponse,
    AccountResponse,
    TradePublicResponse,
    OrderBookResponse,
    OrderBookLevelResponse,
} from "../types/api.types";

/**
 * Serialize a Market to API response format
 */
export function serializeMarket(market: Market): MarketResponse {
    return {
        marketId: market.marketId,
        question: market.question,
        description: market.description,
        resolutionTime: market.resolutionTime.toISOString(),
        createdAt: market.createdAt.toISOString(),
        status: market.status,
        outcome: market.outcome,
        yesPrice: market.yesPrice.toString(),
        noPrice: market.noPrice.toString(),
        volume24h: market.volume24h.toString(),
        totalVolume: market.totalVolume.toString(),
        openInterest: market.openInterest.toString(),
        lastUpdated: market.lastUpdated.toISOString(),
    };
}

/**
 * Serialize an Order to API response format
 */
export function serializeOrder(order: Order): OrderResponse {
    return {
        orderId: order.orderId,
        marketId: order.marketId,
        userId: order.userId,
        side: order.side,
        action: order.action,
        orderType: order.orderType,
        price: order.price.toString(),
        quantity: order.quantity.toString(),
        filledQuantity: order.filledQuantity.toString(),
        status: order.status,
        lockedAmount: order.lockedAmount.toString(),
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
    };
}

/**
 * Serialize a Position to API response format
 */
export function serializePosition(position: Position): PositionResponse {
    return {
        positionId: position.positionId,
        userId: position.userId,
        marketId: position.marketId,
        side: position.side,
        quantity: position.quantity.toString(),
        lockedQuantity: position.lockedQuantity.toString(),
        avgCostBasis: position.avgCostBasis.toString(),
        currentValue: position.currentValue?.toString(),
        unrealizedPnL: position.unrealizedPnL?.toString(),
        lastUpdated: position.lastUpdated.toISOString(),
    };
}

/**
 * Serialize a TradingAccount to API response format
 */
export function serializeAccount(account: TradingAccount): AccountResponse {
    return {
        userId: account.userId,
        partyId: account.partyId,
        availableBalance: account.availableBalance.toString(),
        lockedBalance: account.lockedBalance.toString(),
        lastUpdated: account.lastUpdated.toISOString(),
    };
}

/**
 * Serialize a Trade to public API response format (no user IDs)
 */
export function serializeTrade(trade: Trade): TradePublicResponse {
    return {
        tradeId: trade.tradeId,
        marketId: trade.marketId,
        side: trade.side,
        price: trade.price.toString(),
        quantity: trade.quantity.toString(),
        timestamp: trade.createdAt.toISOString(),
    };
}

/**
 * Serialize a TradePublic to API response format
 */
export function serializeTradePublic(trade: TradePublic): TradePublicResponse {
    return {
        tradeId: trade.tradeId,
        marketId: trade.marketId,
        side: trade.side,
        price: trade.price.toString(),
        quantity: trade.quantity.toString(),
        timestamp: trade.timestamp.toISOString(),
    };
}

/**
 * Serialize an orderbook level
 */
export function serializeOrderBookLevel(level: OrderBookLevel): OrderBookLevelResponse {
    return {
        price: level.price.toString(),
        quantity: level.quantity.toString(),
        orderCount: level.orderCount,
    };
}

/**
 * Serialize an OrderBook to API response format
 */
export function serializeOrderBook(orderbook: OrderBook): OrderBookResponse {
    return {
        marketId: orderbook.marketId,
        yes: {
            bids: orderbook.yes.bids.map(serializeOrderBookLevel),
            asks: orderbook.yes.asks.map(serializeOrderBookLevel),
        },
        no: {
            bids: orderbook.no.bids.map(serializeOrderBookLevel),
            asks: orderbook.no.asks.map(serializeOrderBookLevel),
        },
        lastUpdated: orderbook.lastUpdated.toISOString(),
    };
}
