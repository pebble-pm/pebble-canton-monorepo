/**
 * Global error handler middleware
 *
 * Converts domain errors and API errors to consistent JSON responses
 */

import type { Context } from "hono";
import { ApiError } from "../types/errors";
import { OrderValidationError, OrderNotFoundError } from "../../services";
import type { ErrorResponse } from "../types/api.types";

/**
 * Global error handler for Hono
 * Maps various error types to appropriate HTTP responses
 */
export async function errorHandler(err: Error, c: Context): Promise<Response> {
    // Log all errors (could be enhanced with structured logging)
    console.error(`[API Error] ${err.name}: ${err.message}`);
    if (process.env.NODE_ENV !== "production") {
        console.error(err.stack);
    }

    // Handle known API errors (our custom error classes)
    if (err instanceof ApiError) {
        const response: ErrorResponse = {
            error: err.message,
            code: err.code,
        };
        if (err.details) {
            response.details = err.details;
        }
        return c.json(response, err.statusCode as any);
    }

    // Handle domain-specific errors from services
    if (err instanceof OrderValidationError) {
        const response: ErrorResponse = {
            error: err.message,
            code: err.code,
        };
        return c.json(response, 400);
    }

    if (err instanceof OrderNotFoundError) {
        const response: ErrorResponse = {
            error: err.message,
            code: "ORDER_NOT_FOUND",
        };
        return c.json(response, 404);
    }

    // Handle Canton/ledger errors
    if (err.name === "CommandRejectedError" || err.name === "ContractNotFoundError") {
        const response: ErrorResponse = {
            error: "Canton operation failed",
            code: "CANTON_ERROR",
            details: {
                originalError: err.message,
            },
        };
        return c.json(response, 500);
    }

    // Handle connection errors
    if (err.name === "ConnectionError") {
        const response: ErrorResponse = {
            error: "Service temporarily unavailable",
            code: "SERVICE_UNAVAILABLE",
        };
        return c.json(response, 503);
    }

    // Handle JSON parse errors
    if (err instanceof SyntaxError && "body" in err) {
        const response: ErrorResponse = {
            error: "Invalid JSON in request body",
            code: "INVALID_JSON",
        };
        return c.json(response, 400);
    }

    // Handle validation errors from Hono
    if (err.name === "ValidationError") {
        const response: ErrorResponse = {
            error: err.message || "Validation failed",
            code: "VALIDATION_ERROR",
        };
        return c.json(response, 400);
    }

    // Generic server error (don't leak internal details in production)
    const response: ErrorResponse = {
        error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
        code: "INTERNAL_ERROR",
    };
    return c.json(response, 500);
}
