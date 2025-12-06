/** API base URL - proxied through Vite in development */
export const API_BASE = "/api";

/** WebSocket URL - uses current host */
export const WS_URL = `ws://${typeof window !== "undefined" ? window.location.host : "localhost:3000"}/api/ws`;

/** Default page size for paginated requests */
export const DEFAULT_PAGE_SIZE = 20;

/** Maximum trades to show in history */
export const MAX_TRADES_HISTORY = 50;

/** WebSocket reconnection settings */
export const WS_RECONNECT_DELAY = 3000;
export const WS_MAX_RECONNECT_DELAY = 30000;
export const WS_PING_INTERVAL = 30000;

/** Order price limits */
export const MIN_PRICE = 0.01;
export const MAX_PRICE = 0.99;

/** Query stale times (in ms) */
export const STALE_TIMES = {
    MARKETS: 60 * 1000, // 1 minute
    MARKET_DETAIL: 30 * 1000, // 30 seconds
    ACCOUNT: 30 * 1000, // 30 seconds
    ORDERS: 30 * 1000, // 30 seconds
    POSITIONS: 30 * 1000, // 30 seconds
    PARTIES: 5 * 60 * 1000, // 5 minutes
};

/** Query keys for TanStack Query */
export const QUERY_KEYS = {
    MARKETS: "markets",
    MARKET: "market",
    ORDERS: "orders",
    POSITIONS: "positions",
    ACCOUNT: "account",
    PARTIES: "parties",
} as const;
