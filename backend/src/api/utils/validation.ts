/**
 * Request validation utilities
 */

import { BadRequestError } from "../types/errors";

/**
 * Validate and parse pagination parameters
 * Returns defaults if not provided
 */
export function validatePagination(
    pageParam?: string | null,
    pageSizeParam?: string | null,
    maxPageSize = 100,
): { page: number; pageSize: number } {
    let page = 1;
    let pageSize = 20;

    if (pageParam) {
        const parsed = parseInt(pageParam, 10);
        if (isNaN(parsed) || parsed < 1) {
            throw new BadRequestError("page must be a positive integer", "INVALID_PAGE");
        }
        page = parsed;
    }

    if (pageSizeParam) {
        const parsed = parseInt(pageSizeParam, 10);
        if (isNaN(parsed) || parsed < 1) {
            throw new BadRequestError("pageSize must be a positive integer", "INVALID_PAGE_SIZE");
        }
        if (parsed > maxPageSize) {
            throw new BadRequestError(`pageSize cannot exceed ${maxPageSize}`, "PAGE_SIZE_EXCEEDED");
        }
        pageSize = parsed;
    }

    return { page, pageSize };
}

/**
 * Validate that a string is a valid UUID
 */
export function validateUUID(id: string | undefined | null, fieldName: string): string {
    if (!id) {
        throw new BadRequestError(`${fieldName} is required`, "MISSING_FIELD");
    }

    // UUID v4 regex pattern
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(id)) {
        throw new BadRequestError(`${fieldName} must be a valid UUID`, "INVALID_UUID");
    }

    return id;
}

/**
 * Validate that a value is a positive number
 */
export function validatePositiveNumber(value: unknown, fieldName: string): number {
    if (value === undefined || value === null) {
        throw new BadRequestError(`${fieldName} is required`, "MISSING_FIELD");
    }

    const num = typeof value === "number" ? value : parseFloat(String(value));

    if (isNaN(num)) {
        throw new BadRequestError(`${fieldName} must be a number`, "INVALID_NUMBER");
    }

    if (num <= 0) {
        throw new BadRequestError(`${fieldName} must be positive`, "INVALID_VALUE");
    }

    return num;
}

/**
 * Validate that a value is a non-negative number
 */
export function validateNonNegativeNumber(value: unknown, fieldName: string): number {
    if (value === undefined || value === null) {
        throw new BadRequestError(`${fieldName} is required`, "MISSING_FIELD");
    }

    const num = typeof value === "number" ? value : parseFloat(String(value));

    if (isNaN(num)) {
        throw new BadRequestError(`${fieldName} must be a number`, "INVALID_NUMBER");
    }

    if (num < 0) {
        throw new BadRequestError(`${fieldName} must be non-negative`, "INVALID_VALUE");
    }

    return num;
}

/**
 * Validate that a value is one of the allowed enum values
 */
export function validateEnum<T extends string>(value: unknown, allowed: readonly T[], fieldName: string): T {
    if (value === undefined || value === null) {
        throw new BadRequestError(`${fieldName} is required`, "MISSING_FIELD");
    }

    if (!allowed.includes(value as T)) {
        throw new BadRequestError(`${fieldName} must be one of: ${allowed.join(", ")}`, "INVALID_ENUM");
    }

    return value as T;
}

/**
 * Validate a required string field
 */
export function validateRequiredString(value: unknown, fieldName: string, minLength = 1, maxLength?: number): string {
    if (value === undefined || value === null) {
        throw new BadRequestError(`${fieldName} is required`, "MISSING_FIELD");
    }

    if (typeof value !== "string") {
        throw new BadRequestError(`${fieldName} must be a string`, "INVALID_TYPE");
    }

    if (value.length < minLength) {
        throw new BadRequestError(`${fieldName} must be at least ${minLength} characters`, "STRING_TOO_SHORT");
    }

    if (maxLength !== undefined && value.length > maxLength) {
        throw new BadRequestError(`${fieldName} cannot exceed ${maxLength} characters`, "STRING_TOO_LONG");
    }

    return value;
}

/**
 * Validate an optional string field
 */
export function validateOptionalString(value: unknown, fieldName: string, maxLength?: number): string | undefined {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }

    if (typeof value !== "string") {
        throw new BadRequestError(`${fieldName} must be a string`, "INVALID_TYPE");
    }

    if (maxLength !== undefined && value.length > maxLength) {
        throw new BadRequestError(`${fieldName} cannot exceed ${maxLength} characters`, "STRING_TOO_LONG");
    }

    return value;
}

/**
 * Validate a date string (ISO format)
 */
export function validateDateString(value: unknown, fieldName: string): Date {
    if (value === undefined || value === null) {
        throw new BadRequestError(`${fieldName} is required`, "MISSING_FIELD");
    }

    if (typeof value !== "string") {
        throw new BadRequestError(`${fieldName} must be a string`, "INVALID_TYPE");
    }

    const date = new Date(value);

    if (isNaN(date.getTime())) {
        throw new BadRequestError(`${fieldName} must be a valid ISO date string`, "INVALID_DATE");
    }

    return date;
}

/**
 * Validate a price value (between 0.01 and 0.99)
 */
export function validatePrice(value: unknown, fieldName: string): number {
    const num = validatePositiveNumber(value, fieldName);

    if (num < 0.01 || num > 0.99) {
        throw new BadRequestError(`${fieldName} must be between 0.01 and 0.99`, "INVALID_PRICE");
    }

    return num;
}

/**
 * Validate a boolean value
 */
export function validateBoolean(value: unknown, fieldName: string): boolean {
    if (value === undefined || value === null) {
        throw new BadRequestError(`${fieldName} is required`, "MISSING_FIELD");
    }

    if (typeof value !== "boolean") {
        throw new BadRequestError(`${fieldName} must be a boolean`, "INVALID_TYPE");
    }

    return value;
}
