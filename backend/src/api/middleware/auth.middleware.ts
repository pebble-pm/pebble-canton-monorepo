/**
 * Authentication middleware
 *
 * Handles user authentication via X-User-Id header and admin auth via X-Admin-Key header
 */

import type { Context, Next } from "hono";
import { getAppContext } from "../../index";
import { UnauthorizedError, ForbiddenError } from "../types/errors";

/**
 * User authentication middleware
 * Extracts X-User-Id header and verifies user exists
 * Sets userId in context for downstream handlers
 */
export async function userAuth(c: Context, next: Next): Promise<void | Response> {
    const userId = c.req.header("X-User-Id");

    if (!userId) {
        throw new UnauthorizedError("X-User-Id header required", "MISSING_USER_ID");
    }

    // Verify user exists in accounts
    const ctx = getAppContext();
    const account = ctx.repositories.accounts.getById(userId);

    if (!account) {
        throw new UnauthorizedError("User not found", "USER_NOT_FOUND");
    }

    // Set userId in context for route handlers
    c.set("userId", userId);
    c.set("partyId", account.partyId);

    await next();
}

/**
 * Admin authentication middleware
 * Verifies X-Admin-Key header matches config.adminKey
 */
export async function adminAuth(c: Context, next: Next): Promise<void | Response> {
    const adminKey = c.req.header("X-Admin-Key");
    const ctx = getAppContext();

    if (!adminKey) {
        throw new ForbiddenError("X-Admin-Key header required", "MISSING_ADMIN_KEY");
    }

    if (adminKey !== ctx.config.adminKey) {
        throw new ForbiddenError("Invalid admin key", "INVALID_ADMIN_KEY");
    }

    await next();
}

/**
 * Optional user authentication middleware
 * If X-User-Id is present, validates and sets userId in context
 * If not present, continues without setting userId
 * Use for endpoints that can be personalized but don't require auth
 */
export async function optionalUserAuth(c: Context, next: Next): Promise<void | Response> {
    const userId = c.req.header("X-User-Id");

    if (userId) {
        const ctx = getAppContext();
        const account = ctx.repositories.accounts.getById(userId);

        if (account) {
            c.set("userId", userId);
            c.set("partyId", account.partyId);
        }
        // Don't throw if user not found - just don't set context
    }

    await next();
}

// Type augmentation for Hono context
declare module "hono" {
    interface ContextVariableMap {
        userId: string;
        partyId: string;
    }
}
