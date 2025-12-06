/**
 * Main API setup
 *
 * Creates and configures the Hono application with all routes and middleware
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";

import { rateLimiter, errorHandler } from "./middleware";
import { health, markets, orders, positions, account, parties, faucet, admin } from "./routes";

// ============================================
// Custom Logger with Timestamps
// ============================================

/**
 * Custom logger middleware that adds timestamps to HTTP request logs
 * This ensures HTTP logs have the same timestamp format as other logs
 * Includes user ID for request tracing
 */
const timestampedLogger = (): MiddlewareHandler => {
    return async (c, next) => {
        const method = c.req.method;
        const path = c.req.path;
        const start = Date.now();
        const userId = c.req.header("X-User-Id");
        const userLabel = userId ? userId.slice(0, 20) + "..." : "anonymous";

        // Log incoming request with timestamp and user
        console.log(`[API] --> ${method} ${path} (${userLabel})`);

        await next();

        // Log response with duration and status
        const duration = Date.now() - start;
        const status = c.res.status;
        const statusLabel = status >= 400 ? `${status} ERROR` : `${status}`;
        console.log(`[API] <-- ${method} ${path} ${statusLabel} ${duration}ms`);
    };
};

// Create main Hono app
const app = new Hono();

// ============================================
// Global Middleware
// ============================================

// Request logging with timestamps
app.use("*", timestampedLogger());

// CORS configuration
app.use(
    "*",
    cors({
        origin: "*", // Configure for specific origins in production
        allowHeaders: ["Content-Type", "X-User-Id", "X-Admin-Key", "Idempotency-Key", "Authorization"],
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        exposeHeaders: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"],
        maxAge: 600, // 10 minutes preflight cache
    }),
);

// Rate limiting on API routes (100 requests per minute)
app.use(
    "/api/*",
    rateLimiter({
        maxRequests: 100,
        windowMs: 60000,
    }),
);

// ============================================
// Routes
// ============================================

// Health check (no auth, no rate limiting)
app.route("/health", health);
app.route("/api/health", health);

// API routes
app.route("/api/markets", markets);
app.route("/api/orders", orders);
app.route("/api/positions", positions);
app.route("/api/account", account);
app.route("/api/parties", parties);
app.route("/api/faucet", faucet);
app.route("/api/admin", admin);

// ============================================
// Error Handling
// ============================================

// Global error handler
app.onError(errorHandler);

// 404 handler
app.notFound((c) => {
    return c.json(
        {
            error: "Not found",
            code: "NOT_FOUND",
        },
        404,
    );
});

// ============================================
// Exports
// ============================================

export { app };
export { wsManager, websocketHandlers } from "./websocket";
export { stopRateLimitCleanup } from "./middleware";
