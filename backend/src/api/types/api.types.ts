/**
 * API-specific types for request/response serialization
 *
 * These types use string instead of Decimal for JSON serialization
 */

// Re-export domain request types (they use primitives)
export type {
    CreateMarketRequest,
    ResolveMarketRequest,
} from "../../types/market";
export type { PlaceOrderRequest } from "../../types/order";
export type { DepositRequest, WithdrawRequest } from "../../types/account";
export type { MergePositionsRequest } from "../../types/position";

// ============================================
// Serialized Response Types (Decimal -> string)
// ============================================

/** Serialized market for API response */
export interface MarketResponse {
    marketId: string;
    question: string;
    description: string;
    resolutionTime: string; // ISO date
    createdAt: string;
    status: "open" | "closed" | "resolved";
    outcome?: boolean;
    yesPrice: string;
    noPrice: string;
    volume24h: string;
    totalVolume: string;
    openInterest: string;
    lastUpdated: string;
}

/** Serialized order for API response */
export interface OrderResponse {
    orderId: string;
    marketId: string;
    userId: string;
    side: "yes" | "no";
    action: "buy" | "sell";
    orderType: "limit" | "market";
    price: string;
    quantity: string;
    filledQuantity: string;
    status: string;
    lockedAmount: string;
    createdAt: string;
    updatedAt: string;
}

/** Serialized position for API response */
export interface PositionResponse {
    positionId: string;
    userId: string;
    marketId: string;
    side: "yes" | "no";
    quantity: string;
    lockedQuantity: string;
    avgCostBasis: string;
    currentValue?: string;
    unrealizedPnL?: string;
    lastUpdated: string;
}

/** Serialized account for API response */
export interface AccountResponse {
    userId: string;
    partyId: string;
    availableBalance: string;
    lockedBalance: string;
    lastUpdated: string;
}

/** Serialized trade for API response (public, no user IDs) */
export interface TradePublicResponse {
    tradeId: string;
    marketId: string;
    side: "yes" | "no";
    price: string;
    quantity: string;
    timestamp: string;
}

/** Serialized orderbook level */
export interface OrderBookLevelResponse {
    price: string;
    quantity: string;
    orderCount: number;
}

/** Serialized orderbook */
export interface OrderBookResponse {
    marketId: string;
    yes: {
        bids: OrderBookLevelResponse[];
        asks: OrderBookLevelResponse[];
    };
    no: {
        bids: OrderBookLevelResponse[];
        asks: OrderBookLevelResponse[];
    };
    lastUpdated: string;
}

// ============================================
// Pagination
// ============================================

/** Paginated response wrapper */
export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
}

// ============================================
// Standard Error Response
// ============================================

/** Standard error response format */
export interface ErrorResponse {
    error: string;
    code: string;
    details?: Record<string, unknown>;
}

// ============================================
// WebSocket Message Types
// ============================================

/** Inbound WebSocket message from client */
export interface WsInboundMessage {
    type: "subscribe" | "unsubscribe" | "auth" | "ping";
    channel?: string;
    channels?: string[];
    token?: string;
}

/** Outbound WebSocket event to client */
export interface WsOutboundEvent {
    type: string;
    channel?: string;
    event?: string;
    data?: unknown;
    timestamp: string;
    error?: string;
    message?: string;
}

// ============================================
// API-specific Response Types
// ============================================

/** Place order response */
export interface PlaceOrderApiResponse {
    orderId: string;
    status: string;
    filledQuantity: string;
    remainingQuantity: string;
    trades: Array<{
        tradeId: string;
        price: string;
        quantity: string;
        counterpartyOrderId: string;
    }>;
    lockedAmount: string;
    idempotencyKey?: string;
}

/** Health check response */
export interface HealthResponse {
    status: "healthy" | "degraded" | "unhealthy";
    timestamp: string;
    version: string;
    components: {
        database: "healthy" | "unhealthy";
        canton: "connected" | "offline" | "error";
        eventProcessor: "running" | "stopped";
        settlementService: "running" | "stopped";
        reconciliation: "running" | "stopped";
    };
}

/** Account summary with equity */
export interface AccountSummaryResponse extends AccountResponse {
    totalEquity: string;
    positionsValue: string;
    isAuthorized: boolean;
}

/** Deposit/withdraw response */
export interface FundTransactionResponse {
    transactionId: string;
    amount: string;
    newBalance: string;
}

/** Position with computed values */
export interface PositionWithValueResponse extends PositionResponse {
    currentValue: string;
    unrealizedPnL: string;
}

/** Redemption response */
export interface RedemptionResponse {
    payout: string;
    transactionId: string;
}

/** Merge positions response */
export interface MergeResponse {
    payout: string;
    transactionId: string;
    remainingYesQuantity: string;
    remainingNoQuantity: string;
}

/** Market detail with orderbook and trades */
export interface MarketDetailResponse extends MarketResponse {
    orderbook: OrderBookResponse;
    recentTrades: TradePublicResponse[];
}
