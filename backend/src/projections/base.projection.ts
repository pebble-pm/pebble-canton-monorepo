/**
 * Base projection service
 * Provides common utilities for projection services that maintain off-chain state
 */

import type { Database as BunDatabase } from "bun:sqlite";
import Decimal from "decimal.js";

/**
 * Abstract base class for projection services
 * Provides common utilities for database operations and decimal conversions
 */
export abstract class BaseProjectionService {
    constructor(protected readonly db: BunDatabase) {}

    /**
     * Get current ISO timestamp for last_updated fields
     */
    protected now(): string {
        return new Date().toISOString();
    }

    /**
     * Convert string or number to Decimal
     */
    protected toDecimal(value: string | number): Decimal {
        return new Decimal(value);
    }

    /**
     * Convert Decimal to SQLite-compatible number
     */
    protected toSqlNumber(value: Decimal): number {
        return value.toNumber();
    }

    /**
     * Convert SQLite number to Decimal
     */
    protected fromSqlNumber(value: number | null): Decimal {
        return new Decimal(value ?? 0);
    }

    /**
     * Convert boolean to SQLite integer (0/1)
     */
    protected toSqlBool(value: boolean): number {
        return value ? 1 : 0;
    }

    /**
     * Convert SQLite integer to boolean
     */
    protected fromSqlBool(value: number | null): boolean {
        return value === 1;
    }

    /**
     * Convert Date to ISO string for SQLite storage
     */
    protected toSqlDate(value: Date): string {
        return value.toISOString();
    }

    /**
     * Convert ISO string from SQLite to Date
     */
    protected fromSqlDate(value: string | null): Date | null {
        return value ? new Date(value) : null;
    }
}
