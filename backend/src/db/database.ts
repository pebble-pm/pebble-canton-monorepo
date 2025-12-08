/**
 * SQLite database connection and initialization
 * Uses Bun's native bun:sqlite module
 */

import { Database as BunDatabase } from "bun:sqlite";
import { TABLES, INDEXES, SCHEMA_VERSION } from "./schema";
import { getConfig } from "../config";

export interface DatabaseConnection {
    db: BunDatabase;
    close(): void;
}

/**
 * Initialize SQLite database with schema
 */
export function initDatabase(path?: string): DatabaseConnection {
    const config = getConfig();
    const dbPath = path ?? config.database.path;

    const db = new BunDatabase(dbPath);

    // Enable WAL mode for better concurrency
    if (config.database.walMode) {
        db.run("PRAGMA journal_mode = WAL");
    }

    // Enable foreign keys
    db.run("PRAGMA foreign_keys = ON");

    // Optimize SQLite settings for performance
    db.run("PRAGMA synchronous = NORMAL");
    db.run("PRAGMA cache_size = -64000"); // 64MB cache
    db.run("PRAGMA temp_store = MEMORY");

    // Create tables
    for (const tableSql of Object.values(TABLES)) {
        db.run(tableSql);
    }

    // Create indexes
    for (const indexSql of INDEXES) {
        db.run(indexSql);
    }

    // Set schema version
    db.run("INSERT OR REPLACE INTO system_state (key, value) VALUES (?, ?)", [
        "schema_version",
        String(SCHEMA_VERSION),
    ]);

    console.log(`Database initialized at ${dbPath} (schema v${SCHEMA_VERSION})`);

    return {
        db,
        close() {
            db.close();
        },
    };
}

/**
 * Get current schema version from database
 */
export function getSchemaVersion(db: BunDatabase): number {
    try {
        const result = db.query("SELECT value FROM system_state WHERE key = ?").get("schema_version") as {
            value: string;
        } | null;
        return result ? parseInt(result.value, 10) : 0;
    } catch {
        return 0;
    }
}

/**
 * Get or set a system state value
 */
export function getSystemState(db: BunDatabase, key: string): string | null {
    const result = db.query("SELECT value FROM system_state WHERE key = ?").get(key) as { value: string } | null;
    return result?.value ?? null;
}

export function setSystemState(db: BunDatabase, key: string, value: string): void {
    db.run("INSERT OR REPLACE INTO system_state (key, value) VALUES (?, ?)", [key, value]);
}

/**
 * Get the last processed ledger offset
 */
export function getLastProcessedOffset(db: BunDatabase): string | null {
    return getSystemState(db, "last_processed_offset");
}

/**
 * Set the last processed ledger offset
 */
export function setLastProcessedOffset(db: BunDatabase, offset: string): void {
    setSystemState(db, "last_processed_offset", offset);
}

/**
 * Transaction helper - execute callback in a transaction
 */
export function withTransaction<T>(db: BunDatabase, callback: () => T): T {
    db.run("BEGIN TRANSACTION");
    try {
        const result = callback();
        db.run("COMMIT");
        return result;
    } catch (error) {
        db.run("ROLLBACK");
        throw error;
    }
}

/**
 * Async transaction helper for async callbacks
 */
export async function withTransactionAsync<T>(db: BunDatabase, callback: () => Promise<T>): Promise<T> {
    db.run("BEGIN TRANSACTION");
    try {
        const result = await callback();
        db.run("COMMIT");
        return result;
    } catch (error) {
        db.run("ROLLBACK");
        throw error;
    }
}
