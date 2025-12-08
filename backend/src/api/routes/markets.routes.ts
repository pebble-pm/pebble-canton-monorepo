/**
 * Markets endpoints
 *
 * GET    /api/markets          - List all markets
 * GET    /api/markets/:id      - Get market detail with orderbook
 * POST   /api/markets          - Create market (admin only)
 * POST   /api/markets/:id/resolve - Resolve market (admin only)
 */

import { Hono } from "hono";
import Decimal from "decimal.js";
import { getAppContext } from "../../index";
import { adminAuth, optionalUserAuth } from "../middleware";
import { serializeMarket, serializeOrderBook, serializeTrade } from "../utils/serialize";
import {
    validatePagination,
    validateRequiredString,
    validateOptionalString,
    validateDateString,
    validateBoolean,
} from "../utils/validation";
import { NotFoundError, BadRequestError, ServiceUnavailableError } from "../types/errors";
import type { PaginatedResponse, MarketResponse, MarketDetailResponse } from "../types/api.types";
import { createCommand, exerciseCommand, generateCommandId } from "../../canton/client";
import { Templates, Choices } from "../../canton/templates";

const markets = new Hono();

/**
 * GET /api/markets
 * List all markets with optional status filter and pagination
 */
markets.get("/", optionalUserAuth, async (c) => {
    const ctx = getAppContext();
    const { page, pageSize } = validatePagination(c.req.query("page"), c.req.query("pageSize"));
    const status = c.req.query("status") as "open" | "closed" | "resolved" | undefined;

    // Get markets based on status filter
    let allMarkets = status ? ctx.repositories.markets.getByStatus(status) : ctx.repositories.markets.getAllMarkets();

    // Sort by most recently updated
    allMarkets.sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime());

    const total = allMarkets.length;
    const offset = (page - 1) * pageSize;
    const data = allMarkets.slice(offset, offset + pageSize).map(serializeMarket);

    const response: PaginatedResponse<MarketResponse> = {
        data,
        total,
        page,
        pageSize,
        hasMore: offset + data.length < total,
    };

    return c.json(response);
});

/**
 * GET /api/markets/:marketId
 * Get market detail with orderbook and recent trades
 */
markets.get("/:marketId", optionalUserAuth, async (c) => {
    const ctx = getAppContext();
    const marketId = c.req.param("marketId");

    const market = ctx.repositories.markets.getById(marketId);
    if (!market) {
        throw new NotFoundError("Market not found", "MARKET_NOT_FOUND");
    }

    // Get orderbook from matching engine
    const orderbook = ctx.matchingEngine.getOrderBook(marketId);

    // Get recent trades (last 50)
    const recentTrades = ctx.repositories.trades.getByMarket(marketId, 50).map(serializeTrade);

    const response: MarketDetailResponse = {
        ...serializeMarket(market),
        orderbook: serializeOrderBook(orderbook),
        recentTrades,
    };

    return c.json(response);
});

/**
 * POST /api/markets
 * Create a new market (admin only)
 */
markets.post("/", adminAuth, async (c) => {
    const ctx = getAppContext();
    const body = await c.req.json();

    // Validate request body
    const question = validateRequiredString(body.question, "question", 10, 500);
    const description = validateOptionalString(body.description, "description", 5000) ?? "";
    const resolutionTime = validateDateString(body.resolutionTime, "resolutionTime");

    // Ensure resolution time is in the future
    if (resolutionTime <= new Date()) {
        throw new BadRequestError("Resolution time must be in the future", "INVALID_RESOLUTION_TIME");
    }

    const marketId = crypto.randomUUID();
    const now = new Date();

    const market: {
        marketId: string;
        question: string;
        description: string;
        resolutionTime: Date;
        createdAt: Date;
        status: "open";
        yesPrice: Decimal;
        noPrice: Decimal;
        volume24h: Decimal;
        totalVolume: Decimal;
        openInterest: Decimal;
        lastUpdated: Date;
        version: number;
        contractId?: string;
    } = {
        marketId,
        question,
        description,
        resolutionTime,
        createdAt: now,
        status: "open",
        yesPrice: new Decimal(0.5),
        noPrice: new Decimal(0.5),
        volume24h: new Decimal(0),
        totalVolume: new Decimal(0),
        openInterest: new Decimal(0),
        lastUpdated: now,
        version: 0,
    };

    // Create market contract on Canton (if connected)
    if (ctx.canton && ctx.config.parties.pebbleAdmin) {
        try {
            const result = await ctx.canton.submitCommand({
                userId: "pebble-market-service",
                commandId: generateCommandId(`create-market-${marketId}`),
                actAs: [ctx.config.parties.pebbleAdmin],
                readAs: [ctx.config.parties.pebbleAdmin],
                commands: [
                    createCommand(Templates.Market, {
                        marketId,
                        admin: ctx.config.parties.pebbleAdmin,
                        question,
                        description,
                        resolutionTime: resolutionTime.toISOString(),
                        createdAt: now.toISOString(),
                        status: "Open",
                        outcome: null,
                        version: 0,
                    }),
                ],
            });

            // Store contractId from Canton
            market.contractId = result.contractId;
        } catch (error) {
            console.error("[Markets] Failed to create market on Canton:", error);
            throw new ServiceUnavailableError(
                "Failed to create market on ledger. Please try again.",
                "CANTON_CREATE_FAILED",
            );
        }
    }

    // Save to database (with contractId if Canton succeeded)
    ctx.repositories.markets.create(market);

    return c.json(serializeMarket(market), 201);
});

/**
 * POST /api/markets/:marketId/resolve
 * Resolve a market with outcome (admin only)
 */
markets.post("/:marketId/resolve", adminAuth, async (c) => {
    const ctx = getAppContext();
    const marketId = c.req.param("marketId");
    const body = await c.req.json();

    const outcome = validateBoolean(body.outcome, "outcome");

    const market = ctx.repositories.markets.getById(marketId);
    if (!market) {
        throw new NotFoundError("Market not found", "MARKET_NOT_FOUND");
    }

    // Validate market can be resolved
    if (market.status === "resolved") {
        throw new BadRequestError("Market is already resolved", "MARKET_ALREADY_RESOLVED");
    }

    // Close market first if still open (both off-chain and on-chain)
    if (market.status === "open") {
        ctx.repositories.markets.updateStatus(marketId, "closed");

        // Close on Canton if connected
        if (ctx.canton && ctx.config.parties.pebbleAdmin && market.contractId) {
            try {
                await ctx.canton.submitCommand({
                    userId: "pebble-market-service",
                    commandId: generateCommandId(`close-market-${marketId}`),
                    actAs: [ctx.config.parties.pebbleAdmin],
                    readAs: [ctx.config.parties.pebbleAdmin],
                    commands: [exerciseCommand(Templates.Market, market.contractId, Choices.Market.CloseMarket, {})],
                });
            } catch (error) {
                console.error("[Markets] Failed to close market on Canton:", error);
                // Continue with resolution even if close fails
            }
        }
    }

    // Resolve with outcome (off-chain)
    ctx.repositories.markets.updateStatus(marketId, "resolved", outcome);

    // Execute resolution on Canton via oracle flow
    if (ctx.canton && ctx.config.parties.pebbleAdmin && ctx.config.parties.oracle && market.contractId) {
        try {
            // Submit resolution via AdminOracle
            await ctx.canton.submitCommand({
                userId: "pebble-oracle-service",
                commandId: generateCommandId(`resolve-market-${marketId}`),
                actAs: [ctx.config.parties.oracle],
                readAs: [ctx.config.parties.pebbleAdmin, ctx.config.parties.oracle],
                commands: [
                    exerciseCommand(Templates.Market, market.contractId, Choices.Market.ResolveMarket, { outcome }),
                ],
            });
        } catch (error) {
            console.error("[Markets] Failed to resolve market on Canton:", error);
            // Off-chain state is already updated, log warning but don't throw
            // Reconciliation will eventually sync the states
        }
    }

    const updated = ctx.repositories.markets.getById(marketId)!;
    return c.json(serializeMarket(updated));
});

/**
 * POST /api/markets/:marketId/close
 * Close a market for trading (admin only)
 */
markets.post("/:marketId/close", adminAuth, async (c) => {
    const ctx = getAppContext();
    const marketId = c.req.param("marketId");

    const market = ctx.repositories.markets.getById(marketId);
    if (!market) {
        throw new NotFoundError("Market not found", "MARKET_NOT_FOUND");
    }

    if (market.status !== "open") {
        throw new BadRequestError(`Cannot close market with status: ${market.status}`, "INVALID_MARKET_STATUS");
    }

    // Close market on Canton (if connected)
    if (ctx.canton && ctx.config.parties.pebbleAdmin && market.contractId) {
        try {
            await ctx.canton.submitCommand({
                userId: "pebble-market-service",
                commandId: generateCommandId(`close-market-${marketId}`),
                actAs: [ctx.config.parties.pebbleAdmin],
                readAs: [ctx.config.parties.pebbleAdmin],
                commands: [exerciseCommand(Templates.Market, market.contractId, Choices.Market.CloseMarket, {})],
            });
        } catch (error) {
            console.error("[Markets] Failed to close market on Canton:", error);
            throw new ServiceUnavailableError(
                "Failed to close market on ledger. Please try again.",
                "CANTON_CLOSE_FAILED",
            );
        }
    }

    // Update off-chain state
    ctx.repositories.markets.updateStatus(marketId, "closed");

    const updated = ctx.repositories.markets.getById(marketId)!;
    return c.json(serializeMarket(updated));
});

export { markets };
