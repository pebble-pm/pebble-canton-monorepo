/**
 * Positions endpoints
 *
 * GET  /api/positions              - List positions for authenticated user
 * POST /api/positions/:id/redeem   - Redeem winning position
 * POST /api/positions/merge        - Merge YES+NO positions to collateral
 */

import { Hono } from "hono";
import Decimal from "decimal.js";
import { getAppContext } from "../../index";
import { userAuth } from "../middleware";
import { serializePosition } from "../utils/serialize";
import { validatePositiveNumber, validateRequiredString } from "../utils/validation";
import { NotFoundError, BadRequestError, ServiceUnavailableError } from "../types/errors";
import type { PositionWithValueResponse, RedemptionResponse, MergeResponse } from "../types/api.types";
import { createCommand, exerciseCommand, generateCommandId } from "../../canton/client";
import { Templates, Choices } from "../../canton/templates";

const positions = new Hono();

// All position routes require user authentication
positions.use("*", userAuth);

/**
 * GET /api/positions
 * List all positions for the authenticated user
 * Optional filter: marketId
 */
positions.get("/", async (c) => {
    const ctx = getAppContext();
    const userId = c.get("userId");
    const marketId = c.req.query("marketId");

    // Get non-archived positions
    let userPositions = ctx.repositories.positions.getByUser(userId, false);

    // Filter by market if provided
    if (marketId) {
        userPositions = userPositions.filter((p) => p.marketId === marketId);
    }

    // Enrich with current value and P&L
    const enrichedPositions: PositionWithValueResponse[] = userPositions.map((p) => {
        const market = ctx.repositories.markets.getById(p.marketId);
        const currentPrice = market ? (p.side === "yes" ? market.yesPrice : market.noPrice) : new Decimal(0.5);

        const currentValue = p.quantity.mul(currentPrice);
        const costBasis = p.quantity.mul(p.avgCostBasis);
        const unrealizedPnL = currentValue.minus(costBasis);

        return {
            ...serializePosition(p),
            currentValue: currentValue.toString(),
            unrealizedPnL: unrealizedPnL.toString(),
        };
    });

    // Calculate totals
    const totalValue = enrichedPositions.reduce((sum, p) => sum.plus(new Decimal(p.currentValue)), new Decimal(0));
    const totalPnL = enrichedPositions.reduce((sum, p) => sum.plus(new Decimal(p.unrealizedPnL)), new Decimal(0));

    return c.json({
        data: enrichedPositions,
        totalValue: totalValue.toString(),
        totalPnL: totalPnL.toString(),
    });
});

/**
 * POST /api/positions/:positionId/redeem
 * Redeem a winning position after market resolution
 */
positions.post("/:positionId/redeem", async (c) => {
    const ctx = getAppContext();
    const userId = c.get("userId");
    const positionId = c.req.param("positionId");

    // Get position
    const position = ctx.repositories.positions.getById(positionId);
    if (!position) {
        throw new NotFoundError("Position not found", "POSITION_NOT_FOUND");
    }

    // Verify ownership
    if (position.userId !== userId) {
        throw new NotFoundError("Position not found", "POSITION_NOT_FOUND");
    }

    // Get market
    const market = ctx.repositories.markets.getById(position.marketId);
    if (!market) {
        throw new BadRequestError("Market not found", "MARKET_NOT_FOUND");
    }

    // Verify market is resolved
    if (market.status !== "resolved") {
        throw new BadRequestError("Market is not resolved yet", "MARKET_NOT_RESOLVED");
    }

    // Check if this is a winning position
    const isWinner =
        (market.outcome === true && position.side === "yes") || (market.outcome === false && position.side === "no");

    if (!isWinner) {
        throw new BadRequestError("This position did not win", "POSITION_NOT_WINNER");
    }

    // Check for locked shares (cannot redeem locked positions)
    if (position.lockedQuantity.gt(0)) {
        throw new BadRequestError(
            "Cannot redeem position with locked shares. Cancel pending sell orders first.",
            "POSITION_LOCKED",
        );
    }

    // Calculate payout ($1 per winning share)
    const payout = position.quantity;

    // Execute redemption on Canton first (if connected)
    let transactionId: string = crypto.randomUUID();

    if (ctx.canton && ctx.config.parties.pebbleAdmin && position.contractId) {
        try {
            // Get the user's account for crediting
            const acc = ctx.repositories.accounts.getById(userId);
            if (!acc?.accountContractId) {
                throw new BadRequestError("Account not properly initialized on ledger", "ACCOUNT_NOT_INITIALIZED");
            }

            const result = await ctx.canton.submitCommand({
                userId: "pebble-position-service",
                commandId: generateCommandId(`redeem-${positionId}`),
                actAs: [ctx.config.parties.pebbleAdmin],
                readAs: [ctx.config.parties.pebbleAdmin],
                commands: [
                    exerciseCommand(
                        Templates.MarketSettlement,
                        market.contractId!, // MarketSettlement contractId
                        Choices.MarketSettlement.RedeemPosition,
                        {
                            positionContractId: position.contractId,
                            tradingAccountContractId: acc.accountContractId,
                        },
                    ),
                ],
            });
            transactionId = result.transactionId || transactionId;
        } catch (error) {
            console.error("[Positions] Failed to redeem position on Canton:", error);
            throw new ServiceUnavailableError(
                "Failed to redeem position on ledger. Please try again.",
                "CANTON_REDEEM_FAILED",
            );
        }
    }

    // Credit user account (off-chain)
    ctx.repositories.accounts.creditAvailable(userId, payout);

    // Archive the position (off-chain)
    ctx.repositories.positions.archive(positionId);

    const response: RedemptionResponse = {
        payout: payout.toString(),
        transactionId,
    };

    return c.json(response);
});

/**
 * POST /api/positions/merge
 * Merge YES and NO positions back to collateral ($1 per pair)
 */
positions.post("/merge", async (c) => {
    const ctx = getAppContext();
    const userId = c.get("userId");
    const body = await c.req.json();

    // Validate request
    const marketId = validateRequiredString(body.marketId, "marketId");
    const quantity = validatePositiveNumber(body.quantity, "quantity");
    const mergeQuantity = new Decimal(quantity);

    // Get both YES and NO positions
    const yesPosition = ctx.repositories.positions.getByUserMarketSide(userId, marketId, "yes");
    const noPosition = ctx.repositories.positions.getByUserMarketSide(userId, marketId, "no");

    if (!yesPosition || !noPosition) {
        throw new BadRequestError("Must have both YES and NO positions to merge", "MISSING_POSITIONS");
    }

    // Calculate available (unlocked) quantities
    const availableYes = yesPosition.quantity.minus(yesPosition.lockedQuantity);
    const availableNo = noPosition.quantity.minus(noPosition.lockedQuantity);
    const maxMergeable = Decimal.min(availableYes, availableNo);

    if (maxMergeable.lt(mergeQuantity)) {
        throw new BadRequestError(
            `Can only merge up to ${maxMergeable.toString()} pairs. ` +
                `Available YES: ${availableYes.toString()}, Available NO: ${availableNo.toString()}`,
            "INSUFFICIENT_POSITIONS",
        );
    }

    // Calculate payout ($1 per merged pair)
    const payout = mergeQuantity;

    // Execute merge on Canton first (if connected)
    let transactionId: string = crypto.randomUUID();

    if (ctx.canton && ctx.config.parties.pebbleAdmin && yesPosition.contractId && noPosition.contractId) {
        try {
            // Get the user's account for crediting
            const acc = ctx.repositories.accounts.getById(userId);
            if (!acc?.accountContractId) {
                throw new BadRequestError("Account not properly initialized on ledger", "ACCOUNT_NOT_INITIALIZED");
            }

            // Create and execute a PositionMerge
            const result = await ctx.canton.submitCommand({
                userId: "pebble-position-service",
                commandId: generateCommandId(`merge-${marketId}`),
                actAs: [ctx.config.parties.pebbleAdmin],
                readAs: [ctx.config.parties.pebbleAdmin],
                commands: [
                    createCommand(Templates.PositionMerge, {
                        pebbleAdmin: ctx.config.parties.pebbleAdmin,
                        trader: userId,
                        marketId,
                        yesPositionContractId: yesPosition.contractId,
                        noPositionContractId: noPosition.contractId,
                        tradingAccountContractId: acc.accountContractId,
                        quantity: mergeQuantity.toString(),
                    }),
                ],
            });

            // Execute the merge
            if (result.contractId) {
                const execResult = await ctx.canton.submitCommand({
                    userId: "pebble-position-service",
                    commandId: generateCommandId(`exec-merge-${marketId}`),
                    actAs: [ctx.config.parties.pebbleAdmin],
                    readAs: [ctx.config.parties.pebbleAdmin],
                    commands: [
                        exerciseCommand(
                            Templates.PositionMerge,
                            result.contractId,
                            Choices.PositionMerge.ExecuteMerge,
                            {},
                        ),
                    ],
                });
                transactionId = execResult.transactionId || transactionId;
            }
        } catch (error) {
            console.error("[Positions] Failed to merge positions on Canton:", error);
            throw new ServiceUnavailableError(
                "Failed to merge positions on ledger. Please try again.",
                "CANTON_MERGE_FAILED",
            );
        }
    }

    // Credit user account (off-chain)
    ctx.repositories.accounts.creditAvailable(userId, payout);

    // Reduce both positions (off-chain)
    ctx.repositories.positions.reducePosition(yesPosition.positionId, mergeQuantity);
    ctx.repositories.positions.reducePosition(noPosition.positionId, mergeQuantity);

    // Get updated positions
    const updatedYes = ctx.repositories.positions.getById(yesPosition.positionId);
    const updatedNo = ctx.repositories.positions.getById(noPosition.positionId);

    const response: MergeResponse = {
        payout: payout.toString(),
        transactionId,
        remainingYesQuantity: updatedYes?.quantity.toString() ?? "0",
        remainingNoQuantity: updatedNo?.quantity.toString() ?? "0",
    };

    return c.json(response);
});

export { positions };
