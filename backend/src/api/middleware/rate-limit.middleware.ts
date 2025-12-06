/**
 * Rate limiting middleware
 *
 * In-memory rate limiting with configurable window and max requests
 * Per-process (resets on restart) - suitable for development and single-node deployments
 * For production with multiple nodes, use Redis-backed rate limiting
 */

import type { Context, Next } from "hono";
import { RateLimitError } from "../types/errors";

/** Rate limit entry for a single key */
interface RateLimitEntry {
    count: number;
    resetAt: number;
}

/** Rate limiter configuration */
export interface RateLimitConfig {
    /** Time window in milliseconds (default: 60000 = 1 minute) */
    windowMs: number;
    /** Maximum requests per window (default: 100) */
    maxRequests: number;
    /** Function to generate the rate limit key from request context */
    keyGenerator: (c: Context) => string;
    /** Whether to skip rate limiting for certain requests */
    skip?: (c: Context) => boolean;
}

// In-memory store for rate limit entries
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup interval reference for graceful shutdown
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Default key generator
 * Uses userId if available, then forwarded IP, then connecting IP, then "anonymous"
 */
function defaultKeyGenerator(c: Context): string {
    const userId = c.get("userId");
    if (userId) return `user:${userId}`;

    const forwardedFor = c.req.header("x-forwarded-for");
    if (forwardedFor) {
        // Take the first IP in the chain (original client)
        const clientIp = forwardedFor.split(",")[0].trim();
        return `ip:${clientIp}`;
    }

    const cfConnectingIp = c.req.header("cf-connecting-ip");
    if (cfConnectingIp) return `ip:${cfConnectingIp}`;

    return "anonymous";
}

/**
 * Create rate limiter middleware
 */
export function rateLimiter(config: Partial<RateLimitConfig> = {}) {
    const windowMs = config.windowMs ?? 60000; // 1 minute default
    const maxRequests = config.maxRequests ?? 100; // 100 requests default
    const keyGenerator = config.keyGenerator ?? defaultKeyGenerator;
    const skip = config.skip;

    // Start cleanup interval if not already running
    if (!cleanupInterval) {
        cleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const [key, entry] of rateLimitStore) {
                if (entry.resetAt < now) {
                    rateLimitStore.delete(key);
                }
            }
        }, windowMs);

        // Don't block process exit
        if (cleanupInterval.unref) {
            cleanupInterval.unref();
        }
    }

    return async function rateLimitMiddleware(c: Context, next: Next): Promise<void | Response> {
        // Check if we should skip rate limiting for this request
        if (skip && skip(c)) {
            await next();
            return;
        }

        const key = keyGenerator(c);
        const now = Date.now();

        // Get or create rate limit entry
        let entry = rateLimitStore.get(key);
        if (!entry || entry.resetAt < now) {
            entry = { count: 0, resetAt: now + windowMs };
            rateLimitStore.set(key, entry);
        }

        // Increment counter
        entry.count++;

        // Set rate limit headers
        const remaining = Math.max(0, maxRequests - entry.count);
        const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);

        c.header("X-RateLimit-Limit", String(maxRequests));
        c.header("X-RateLimit-Remaining", String(remaining));
        c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

        // Check if limit exceeded
        if (entry.count > maxRequests) {
            c.header("Retry-After", String(resetSeconds));
            throw new RateLimitError(`Rate limit exceeded. Try again in ${resetSeconds} seconds.`, resetSeconds);
        }

        await next();
    };
}

/**
 * Stop the cleanup interval (for graceful shutdown)
 */
export function stopRateLimitCleanup(): void {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
    }
}

/**
 * Clear all rate limit entries (for testing)
 */
export function clearRateLimitStore(): void {
    rateLimitStore.clear();
}

/**
 * Get current rate limit stats (for monitoring)
 */
export function getRateLimitStats(): { entries: number; keys: string[] } {
    return {
        entries: rateLimitStore.size,
        keys: Array.from(rateLimitStore.keys()),
    };
}
