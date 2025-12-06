/**
 * API Response Types
 *
 * Mirrors backend types from backend/src/api/types/api.types.ts
 * All decimal values are strings from the API for precision
 */

// ============================================
// Market Types
// ============================================

export interface MarketResponse {
    marketId: string;
    question: string;
    description: string;
    resolutionTime: string;
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

export interface OrderBookLevelResponse {
    price: string;
    quantity: string;
    orderCount: number;
}

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

export interface TradePublicResponse {
    tradeId: string;
    marketId: string;
    side: "yes" | "no";
    price: string;
    quantity: string;
    timestamp: string;
}

export interface MarketDetailResponse extends MarketResponse {
    orderbook: OrderBookResponse;
    recentTrades: TradePublicResponse[];
}

// ============================================
// Order Types
// ============================================

export type OrderSide = "yes" | "no";
export type OrderAction = "buy" | "sell";
export type OrderType = "limit" | "market";
export type OrderStatus = "open" | "filled" | "partial" | "cancelled";

export interface OrderResponse {
    orderId: string;
    marketId: string;
    userId: string;
    side: OrderSide;
    action: OrderAction;
    orderType: OrderType;
    price: string;
    quantity: string;
    filledQuantity: string;
    status: OrderStatus;
    lockedAmount: string;
    createdAt: string;
    updatedAt: string;
}

export interface PlaceOrderRequest {
    marketId: string;
    side: OrderSide;
    action: OrderAction;
    orderType?: OrderType;
    price: number;
    quantity: number;
    idempotencyKey?: string;
}

export interface PlaceOrderResponse {
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

// ============================================
// Position Types
// ============================================

export interface PositionResponse {
    positionId: string;
    oderId: string;
    marketId: string;
    side: OrderSide;
    quantity: string;
    lockedQuantity: string;
    avgCostBasis: string;
    currentValue?: string;
    unrealizedPnL?: string;
    lastUpdated: string;
}

export interface PositionWithValueResponse extends PositionResponse {
    currentValue: string;
    unrealizedPnL: string;
}

export interface RedeemPositionRequest {
    partyId: string;
    marketId: string;
    side: OrderSide;
}

export interface RedemptionResponse {
    payout: string;
    transactionId: string;
}

// ============================================
// Account Types
// ============================================

export interface AccountResponse {
    userId: string;
    partyId: string;
    availableBalance: string;
    lockedBalance: string;
    lastUpdated: string;
}

export interface AccountSummaryResponse extends AccountResponse {
    totalEquity: string;
    positionsValue: string;
    isAuthorized: boolean;
}

// ============================================
// Party Types
// ============================================

/** Party in list response (uses 'id') */
export interface PartyResponse {
    id: string;
    displayName: string;
    isSystem?: boolean;
}

/** Response from allocate party (uses 'partyId') */
export interface AllocatePartyResponse {
    partyId: string;
    displayName: string;
    userId: string;
    accountCreated: boolean;
}

/** Response from login (uses 'partyId') */
export interface LoginResponse {
    partyId: string;
    displayName: string;
    userId: string;
    accountExists: boolean;
}

export interface AllocatePartyRequest {
    displayName: string;
}

export interface LoginRequest {
    partyId: string;
}

// ============================================
// Faucet Types
// ============================================

export interface FaucetConfig {
    initialAmount: number;
    subsequentAmount: number;
    cooldownMinutes: number;
}

export interface FaucetStatusResponse {
    canRequest: boolean;
    nextAvailableAt: string | null;
    lastRequestAt: string | null;
    totalReceived: string;
    requestCount: number;
    config: FaucetConfig;
}

export interface FaucetRequestResponse {
    success: boolean;
    amount: string;
    newBalance: string;
    message: string;
}

// ============================================
// Health Types
// ============================================

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

// ============================================
// Pagination
// ============================================

export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
}

// ============================================
// Error Response
// ============================================

export interface ErrorResponse {
    error: string;
    code: string;
    details?: Record<string, unknown>;
}

// ============================================
// WebSocket Types
// ============================================

export interface WsInboundMessage {
    type: "subscribe" | "unsubscribe" | "auth" | "ping";
    channel?: string;
    channels?: string[];
    token?: string;
}

export interface WsOutboundEvent {
    type: string;
    channel?: string;
    event?: string;
    data?: unknown;
    timestamp: string;
    error?: string;
    message?: string;
}
