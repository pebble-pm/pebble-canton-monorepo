/**
 * Orders endpoints
 *
 * GET    /api/orders           - List orders for authenticated user
 * GET    /api/orders/:orderId  - Get single order
 * POST   /api/orders           - Place a new order
 * DELETE /api/orders/:orderId  - Cancel an order
 */

import { Hono } from "hono";
import { getAppContext } from "../../index";
import { userAuth } from "../middleware";
import { serializeOrder } from "../utils/serialize";
import { validateRequiredString, validateEnum, validatePositiveNumber, validatePrice } from "../utils/validation";
import { NotFoundError, BadRequestError } from "../types/errors";
import type { PlaceOrderApiResponse } from "../types/api.types";

const orders = new Hono();

// All order routes require user authentication
orders.use("*", userAuth);

/**
 * GET /api/orders
 * List orders for the authenticated user
 * Optional filters: marketId, status
 */
orders.get("/", async (c) => {
    const ctx = getAppContext();
    const userId = c.get("userId");
    const marketId = c.req.query("marketId");
    const status = c.req.query("status");

    let userOrders = ctx.orderService.getOrdersByUser(userId, marketId || undefined);

    // Filter by status if provided
    if (status) {
        userOrders = userOrders.filter((o) => o.status === status);
    }

    // Sort by most recent first
    userOrders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return c.json({
        data: userOrders.map(serializeOrder),
    });
});

/**
 * GET /api/orders/:orderId
 * Get a single order by ID
 * Only returns orders belonging to the authenticated user
 */
orders.get("/:orderId", async (c) => {
    const ctx = getAppContext();
    const userId = c.get("userId");
    const orderId = c.req.param("orderId");

    const order = ctx.orderService.getOrderById(orderId);

    if (!order) {
        throw new NotFoundError("Order not found", "ORDER_NOT_FOUND");
    }

    // Don't reveal existence of other users' orders
    if (order.userId !== userId) {
        throw new NotFoundError("Order not found", "ORDER_NOT_FOUND");
    }

    return c.json(serializeOrder(order));
});

/**
 * POST /api/orders
 * Place a new order
 * Supports idempotency via Idempotency-Key header
 */
orders.post("/", async (c) => {
    const ctx = getAppContext();
    const userId = c.get("userId");
    const idempotencyKey = c.req.header("Idempotency-Key");

    const body = await c.req.json();

    // Validate request body
    const marketId = validateRequiredString(body.marketId, "marketId");
    const side = validateEnum(body.side, ["yes", "no"] as const, "side");
    const action = validateEnum(body.action, ["buy", "sell"] as const, "action");
    const orderType = validateEnum(body.orderType, ["limit", "market"] as const, "orderType");
    const quantity = validatePositiveNumber(body.quantity, "quantity");

    // Price validation depends on order type
    let price: number | undefined;
    if (orderType === "limit") {
        price = validatePrice(body.price, "price");
    } else if (body.price !== undefined) {
        // Market orders can optionally specify max price for buys
        price = validatePrice(body.price, "price");
    }

    // Additional validation
    if (quantity > 1_000_000) {
        throw new BadRequestError("Quantity cannot exceed 1,000,000", "QUANTITY_TOO_LARGE");
    }

    // Place the order via OrderService
    const result = await ctx.orderService.placeOrder(
        userId,
        {
            marketId,
            side,
            action,
            orderType,
            price,
            quantity,
        },
        idempotencyKey,
    );

    // Serialize response
    const response: PlaceOrderApiResponse = {
        orderId: result.orderId,
        status: result.status,
        filledQuantity: result.filledQuantity.toString(),
        remainingQuantity: result.remainingQuantity.toString(),
        trades: result.trades.map((t) => ({
            tradeId: t.tradeId,
            price: t.price.toString(),
            quantity: t.quantity.toString(),
            counterpartyOrderId: t.counterpartyOrderId,
        })),
        lockedAmount: result.lockedAmount.toString(),
        idempotencyKey: result.idempotencyKey,
    };

    return c.json(response, 201);
});

/**
 * DELETE /api/orders/:orderId
 * Cancel an existing order
 * Only allows cancelling orders belonging to the authenticated user
 */
orders.delete("/:orderId", async (c) => {
    const ctx = getAppContext();
    const userId = c.get("userId");
    const orderId = c.req.param("orderId");

    // OrderService handles ownership verification and throws if not found
    const cancelled = await ctx.orderService.cancelOrder(userId, orderId);

    return c.json({
        ...serializeOrder(cancelled),
        message: "Order cancelled successfully",
    });
});

export { orders };
