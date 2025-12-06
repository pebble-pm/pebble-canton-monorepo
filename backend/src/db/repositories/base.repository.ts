/**
 * Base repository class with common patterns
 */

import type { Database as BunDatabase } from "bun:sqlite";
import Decimal from "decimal.js";

export abstract class BaseRepository {
    constructor(protected db: BunDatabase) {}

    /**
     * Get current timestamp as ISO string
     */
    protected now(): string {
        return new Date().toISOString();
    }

    /**
     * Convert Decimal to number for SQLite storage
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
     * Convert Date to ISO string for SQLite
     */
    protected toSqlDate(date: Date): string {
        return date.toISOString();
    }

    /**
     * Convert ISO string to Date
     */
    protected fromSqlDate(value: string): Date {
        return new Date(value);
    }

    /**
     * Convert boolean to SQLite integer
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
     * Convert optional string (null handling)
     */
    protected toSqlOptional<T>(value: T | undefined | null): T | null {
        return value ?? null;
    }

    /**
     * Generate a UUID for new records
     */
    protected generateId(): string {
        return crypto.randomUUID();
    }
}
