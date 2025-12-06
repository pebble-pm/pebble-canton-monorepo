/**
 * Custom API error classes for consistent error handling
 */

/**
 * Base API error class
 * All API errors extend this to enable consistent error handling in middleware
 */
export class ApiError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code: string,
        message: string,
        public readonly details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = "ApiError";
        // Maintain proper stack trace in V8 environments
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

/**
 * 400 Bad Request - Invalid input or validation failure
 */
export class BadRequestError extends ApiError {
    constructor(message: string, code = "BAD_REQUEST", details?: Record<string, unknown>) {
        super(400, code, message, details);
        this.name = "BadRequestError";
    }
}

/**
 * 401 Unauthorized - Missing or invalid authentication
 */
export class UnauthorizedError extends ApiError {
    constructor(message = "Authentication required", code = "UNAUTHORIZED") {
        super(401, code, message);
        this.name = "UnauthorizedError";
    }
}

/**
 * 403 Forbidden - Valid auth but insufficient permissions
 */
export class ForbiddenError extends ApiError {
    constructor(message = "Access denied", code = "FORBIDDEN") {
        super(403, code, message);
        this.name = "ForbiddenError";
    }
}

/**
 * 404 Not Found - Resource does not exist
 */
export class NotFoundError extends ApiError {
    constructor(message = "Resource not found", code = "NOT_FOUND") {
        super(404, code, message);
        this.name = "NotFoundError";
    }
}

/**
 * 409 Conflict - Resource state conflict
 */
export class ConflictError extends ApiError {
    constructor(message: string, code = "CONFLICT", details?: Record<string, unknown>) {
        super(409, code, message, details);
        this.name = "ConflictError";
    }
}

/**
 * 429 Too Many Requests - Rate limit exceeded
 */
export class RateLimitError extends ApiError {
    constructor(
        message = "Rate limit exceeded",
        public readonly retryAfterSeconds?: number,
    ) {
        super(429, "RATE_LIMIT_EXCEEDED", message, retryAfterSeconds ? { retryAfter: retryAfterSeconds } : undefined);
        this.name = "RateLimitError";
    }
}

/**
 * 500 Internal Server Error - Unexpected server error
 */
export class InternalServerError extends ApiError {
    constructor(message = "Internal server error", code = "INTERNAL_ERROR") {
        super(500, code, message);
        this.name = "InternalServerError";
    }
}

/**
 * 503 Service Unavailable - Service temporarily unavailable
 */
export class ServiceUnavailableError extends ApiError {
    constructor(message = "Service unavailable", code = "SERVICE_UNAVAILABLE") {
        super(503, code, message);
        this.name = "ServiceUnavailableError";
    }
}
