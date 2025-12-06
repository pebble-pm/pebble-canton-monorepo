/**
 * Admin endpoints
 *
 * All endpoints require the PebbleAdmin party
 *
 * GET  /api/admin/stats          - Platform statistics
 * GET  /api/admin/users          - List all users
 * POST /api/admin/markets        - Create a new market
 * POST /api/admin/markets/:id/close   - Close a market
 * POST /api/admin/markets/:id/resolve - Resolve a market
 */

import { Hono } from "hono";
import Decimal from "decimal.js";
import { getAppContext } from "../../index";
import { ForbiddenError, BadRequestError, NotFoundError, ServiceUnavailableError } from "../types/errors";
import { createCommand, exerciseCommand, generateCommandId } from "../../canton/client";
import { Templates, Choices } from "../../canton/templates";
import type { MiddlewareHandler } from "hono";

// Type for admin context variables
type AdminEnv = {
    Variables: {
        adminParty: string;
    };
};

const admin = new Hono<AdminEnv>();

/**
 * Admin authentication middleware
 * Checks if the user is the PebbleAdmin
 */
const adminAuth: MiddlewareHandler<AdminEnv> = async (c, next) => {
    const ctx = getAppContext();
    const userId = c.req.header("X-User-Id");

    if (!userId) {
        throw new ForbiddenError("Admin authentication required", "ADMIN_AUTH_REQUIRED");
    }

    // Check if user is PebbleAdmin
    if (!ctx.config.parties.pebbleAdmin) {
        throw new ServiceUnavailableError("PebbleAdmin not configured", "ADMIN_NOT_CONFIGURED");
    }

    if (userId !== ctx.config.parties.pebbleAdmin) {
        throw new ForbiddenError("Access denied. Admin privileges required.", "ADMIN_ACCESS_DENIED");
    }

    c.set("adminParty", ctx.config.parties.pebbleAdmin);
    await next();
};

// Apply admin auth to all routes
admin.use("*", adminAuth);

/**
 * GET /api/admin/stats
 * Get platform statistics
 */
admin.get("/stats", async (c) => {
    const ctx = getAppContext();

    // Get counts
    const marketCount = ctx.db.db.query("SELECT COUNT(*) as count FROM markets").get() as { count: number };
    const openMarketCount = ctx.db.db.query("SELECT COUNT(*) as count FROM markets WHERE status = 'open'").get() as { count: number };
    const userCount = ctx.db.db.query("SELECT COUNT(*) as count FROM accounts").get() as { count: number };
    const orderCount = ctx.db.db.query("SELECT COUNT(*) as count FROM orders").get() as { count: number };
    const tradeCount = ctx.db.db.query("SELECT COUNT(*) as count FROM trades").get() as { count: number };

    // Get total volume
    const volumeResult = ctx.db.db.query("SELECT SUM(total_volume) as total FROM markets").get() as { total: number | null };
    const totalVolume = volumeResult.total || 0;

    // Get total balances
    const balanceResult = ctx.db.db.query("SELECT SUM(available_balance + locked_balance) as total FROM accounts").get() as {
        total: number | null;
    };
    const totalBalances = balanceResult.total || 0;

    // Get pending trades
    const pendingTrades = ctx.db.db.query("SELECT COUNT(*) as count FROM trades WHERE settlement_status = 'pending'").get() as {
        count: number;
    };

    // Get recent activity (last 24h)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentOrders = ctx.db.db.query("SELECT COUNT(*) as count FROM orders WHERE created_at > ?").get(yesterday) as { count: number };
    const recentTrades = ctx.db.db.query("SELECT COUNT(*) as count FROM trades WHERE created_at > ?").get(yesterday) as { count: number };

    return c.json({
        markets: {
            total: marketCount.count,
            open: openMarketCount.count,
            closed: marketCount.count - openMarketCount.count,
        },
        users: {
            total: userCount.count,
        },
        orders: {
            total: orderCount.count,
            last24h: recentOrders.count,
        },
        trades: {
            total: tradeCount.count,
            pending: pendingTrades.count,
            last24h: recentTrades.count,
        },
        volume: {
            total: totalVolume.toString(),
        },
        balances: {
            total: totalBalances.toString(),
        },
        cantonConnected: !!ctx.canton,
    });
});

/**
 * GET /api/admin/users
 * List all users with their balances
 */
admin.get("/users", async (c) => {
    const ctx = getAppContext();

    const accounts = ctx.repositories.accounts.getAll();

    const users = accounts.map((acc) => {
        // Get position count for this user
        const positionCount = ctx.db.db
            .query("SELECT COUNT(*) as count FROM positions WHERE user_id = ? AND is_archived = 0")
            .get(acc.userId) as { count: number };

        // Get order count for this user
        const orderCount = ctx.db.db.query("SELECT COUNT(*) as count FROM orders WHERE user_id = ?").get(acc.userId) as { count: number };

        // Get faucet usage
        const faucetResult = ctx.db.db
            .query("SELECT COUNT(*) as count, SUM(amount) as total FROM faucet_requests WHERE user_id = ?")
            .get(acc.userId) as { count: number; total: number | null };

        return {
            userId: acc.userId,
            partyId: acc.partyId,
            displayName: acc.partyId.split("::")[0],
            availableBalance: acc.availableBalance.toString(),
            lockedBalance: acc.lockedBalance.toString(),
            totalBalance: acc.availableBalance.plus(acc.lockedBalance).toString(),
            hasCantonAccount: !!acc.accountContractId,
            positionCount: positionCount.count,
            orderCount: orderCount.count,
            faucetRequests: faucetResult.count,
            faucetTotal: (faucetResult.total || 0).toString(),
            lastUpdated: acc.lastUpdated.toISOString(),
        };
    });

    return c.json({ users });
});

/**
 * POST /api/admin/markets
 * Create a new prediction market
 */
admin.post("/markets", async (c) => {
    const ctx = getAppContext();
    const body = await c.req.json();

    const { question, description, resolutionTime } = body as {
        question?: string;
        description?: string;
        resolutionTime?: string;
    };

    // Validation
    if (!question || typeof question !== "string" || question.trim().length < 10) {
        throw new BadRequestError("Question must be at least 10 characters", "INVALID_QUESTION");
    }

    if (!resolutionTime) {
        throw new BadRequestError("resolutionTime is required", "MISSING_RESOLUTION_TIME");
    }

    const resolutionDate = new Date(resolutionTime);
    if (isNaN(resolutionDate.getTime())) {
        throw new BadRequestError("Invalid resolutionTime format", "INVALID_RESOLUTION_TIME");
    }

    if (resolutionDate <= new Date()) {
        throw new BadRequestError("resolutionTime must be in the future", "RESOLUTION_TIME_PAST");
    }

    const marketId = `market-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const adminParty = c.get("adminParty");
    const now = new Date();

    // Create market on Canton if available
    let contractId: string | undefined;

    if (ctx.canton) {
        try {
            const result = await ctx.canton.submitCommand({
                userId: "pebble-admin-service",
                commandId: generateCommandId(`create-market-${marketId}`),
                actAs: [adminParty],
                readAs: [adminParty],
                commands: [
                    createCommand(Templates.Market, {
                        marketId,
                        admin: adminParty,
                        question: question.trim(),
                        description: description?.trim() || "",
                        resolutionTime: resolutionDate.toISOString(),
                        createdAt: now.toISOString(),
                        status: "Open",
                        outcome: null,
                        version: "0",
                    }),
                ],
            });
            contractId = result.contractId;
            console.log(`[Admin] Created market on Canton: ${contractId?.slice(0, 40)}...`);
        } catch (error) {
            console.error("[Admin] Failed to create market on Canton:", error);
            throw new ServiceUnavailableError("Failed to create market on ledger. Please try again.", "CANTON_CREATE_MARKET_FAILED");
        }
    }

    // Create market in database
    ctx.repositories.markets.create({
        marketId,
        question: question.trim(),
        description: description?.trim() || "",
        resolutionTime: resolutionDate,
        createdAt: now,
        status: "open",
        outcome: undefined,
        contractId,
        version: 0,
        yesPrice: new Decimal(0.5),
        noPrice: new Decimal(0.5),
        volume24h: new Decimal(0),
        totalVolume: new Decimal(0),
        openInterest: new Decimal(0),
        lastUpdated: now,
    });

    console.log(`[Admin] Created market: ${marketId}`);

    return c.json(
        {
            marketId,
            question: question.trim(),
            description: description?.trim() || null,
            resolutionTime: resolutionDate.toISOString(),
            status: "open",
            contractId,
        },
        201,
    );
});

/**
 * POST /api/admin/markets/:id/close
 * Close a market (stop trading)
 */
admin.post("/markets/:id/close", async (c) => {
    const ctx = getAppContext();
    const marketId = c.req.param("id");
    const adminParty = c.get("adminParty");

    const market = ctx.repositories.markets.getById(marketId);
    if (!market) {
        throw new NotFoundError("Market not found", "MARKET_NOT_FOUND");
    }

    if (market.status !== "open") {
        throw new BadRequestError(`Market is already ${market.status}`, "MARKET_NOT_OPEN");
    }

    // Close on Canton if available
    let newContractId: string | undefined;
    if (ctx.canton && market.contractId) {
        try {
            const result = await ctx.canton.submitCommand({
                userId: "pebble-admin-service",
                commandId: generateCommandId(`close-market-${marketId}`),
                actAs: [adminParty],
                readAs: [adminParty],
                commands: [exerciseCommand(Templates.Market, market.contractId, Choices.Market.CloseMarket, {})],
            });
            // CloseMarket creates a new contract with updated status - capture the new contract ID
            newContractId = result.contractId;
            console.log(`[Admin] Closed market on Canton: ${marketId}, new contractId: ${newContractId?.slice(0, 40)}...`);
        } catch (error) {
            console.error("[Admin] Failed to close market on Canton:", error);
            throw new ServiceUnavailableError("Failed to close market on ledger. Please try again.", "CANTON_CLOSE_MARKET_FAILED");
        }
    }

    // Update database with new status and contract ID
    ctx.repositories.markets.updateStatus(marketId, "closed");
    if (newContractId) {
        ctx.repositories.markets.updateContractId(marketId, newContractId, (market.version ?? 0) + 1);
    }
    console.log(`[Admin] Closed market: ${marketId}`);

    return c.json({
        marketId,
        status: "closed",
        message: "Market closed successfully. Trading is now disabled.",
    });
});

/**
 * POST /api/admin/markets/:id/resolve
 * Resolve a market with an outcome
 */
admin.post("/markets/:id/resolve", async (c) => {
    const ctx = getAppContext();
    const marketId = c.req.param("id");
    const adminParty = c.get("adminParty");
    const body = await c.req.json();

    const { outcome } = body as { outcome?: boolean };

    if (typeof outcome !== "boolean") {
        throw new BadRequestError("outcome must be a boolean (true for YES, false for NO)", "INVALID_OUTCOME");
    }

    const market = ctx.repositories.markets.getById(marketId);
    if (!market) {
        throw new NotFoundError("Market not found", "MARKET_NOT_FOUND");
    }

    if (market.status === "resolved") {
        throw new BadRequestError("Market is already resolved", "MARKET_ALREADY_RESOLVED");
    }

    // Market must be closed before resolving
    if (market.status !== "closed") {
        throw new BadRequestError("Market must be closed before resolving", "MARKET_NOT_CLOSED");
    }

    // Resolve on Canton if available
    if (ctx.canton && market.contractId) {
        try {
            const result = await ctx.canton.submitCommand({
                userId: "pebble-admin-service",
                commandId: generateCommandId(`resolve-market-${marketId}`),
                actAs: [adminParty],
                readAs: [adminParty],
                commands: [
                    exerciseCommand(Templates.Market, market.contractId, Choices.Market.ResolveMarket, {
                        marketOutcome: outcome,
                    }),
                ],
            });
            // ResolveMarket creates a new contract with resolved status
            const newContractId = result.contractId;
            console.log(
                `[Admin] Resolved market on Canton: ${marketId} -> ${outcome ? "YES" : "NO"}, new contractId: ${newContractId?.slice(0, 40)}...`,
            );

            // Update contract ID in database
            if (newContractId) {
                ctx.repositories.markets.updateContractId(marketId, newContractId, (market.version ?? 0) + 1);
            }
        } catch (error) {
            console.error("[Admin] Failed to resolve market on Canton:", error);
            throw new ServiceUnavailableError("Failed to resolve market on ledger. Please try again.", "CANTON_RESOLVE_MARKET_FAILED");
        }
    }

    // Update database status
    ctx.repositories.markets.updateStatus(marketId, "resolved", outcome);
    console.log(`[Admin] Resolved market: ${marketId} -> ${outcome ? "YES" : "NO"}`);

    return c.json({
        marketId,
        status: "resolved",
        outcome,
        outcomeLabel: outcome ? "YES" : "NO",
        message: `Market resolved as ${outcome ? "YES" : "NO"}. Winners can now redeem positions.`,
    });
});

export { admin };
