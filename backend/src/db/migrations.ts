/**
 * Database migration system for schema updates
 */

import { Database as BunDatabase } from "bun:sqlite";
import { getSchemaVersion, setSystemState } from "./database";

interface Migration {
    version: number;
    name: string;
    up(db: BunDatabase): void;
    down(db: BunDatabase): void;
}

// Define migrations here
const migrations: Migration[] = [
    // Example future migration:
    // {
    //   version: 2,
    //   name: 'add_order_expiry',
    //   up(db) {
    //     db.run('ALTER TABLE orders ADD COLUMN expires_at TEXT');
    //   },
    //   down(db) {
    //     // SQLite doesn't support DROP COLUMN easily
    //     // Would need to recreate table
    //   },
    // },
];

/**
 * Run all pending migrations
 */
export function runMigrations(db: BunDatabase): void {
    const currentVersion = getSchemaVersion(db);

    const pendingMigrations = migrations
        .filter((m) => m.version > currentVersion)
        .sort((a, b) => a.version - b.version);

    if (pendingMigrations.length === 0) {
        console.log("Database schema is up to date");
        return;
    }

    console.log(`Running ${pendingMigrations.length} migrations...`);

    for (const migration of pendingMigrations) {
        console.log(`  Migrating to v${migration.version}: ${migration.name}`);

        db.run("BEGIN TRANSACTION");
        try {
            migration.up(db);
            setSystemState(db, "schema_version", String(migration.version));
            db.run("COMMIT");
        } catch (error) {
            db.run("ROLLBACK");
            throw new Error(`Migration ${migration.name} failed: ${error}`);
        }
    }

    console.log("All migrations complete");
}

/**
 * Rollback to a specific version
 */
export function rollbackTo(db: BunDatabase, targetVersion: number): void {
    const currentVersion = getSchemaVersion(db);

    if (targetVersion >= currentVersion) {
        console.log("Nothing to rollback");
        return;
    }

    const migrationsToRollback = migrations
        .filter((m) => m.version > targetVersion && m.version <= currentVersion)
        .sort((a, b) => b.version - a.version); // Descending order

    console.log(`Rolling back ${migrationsToRollback.length} migrations...`);

    for (const migration of migrationsToRollback) {
        console.log(`  Rolling back v${migration.version}: ${migration.name}`);

        db.run("BEGIN TRANSACTION");
        try {
            migration.down(db);
            setSystemState(db, "schema_version", String(migration.version - 1));
            db.run("COMMIT");
        } catch (error) {
            db.run("ROLLBACK");
            throw new Error(`Rollback of ${migration.name} failed: ${error}`);
        }
    }

    console.log(`Rolled back to version ${targetVersion}`);
}

/**
 * Get migration status
 */
export function getMigrationStatus(db: BunDatabase): {
    currentVersion: number;
    pendingCount: number;
    migrations: Array<{ version: number; name: string; applied: boolean }>;
} {
    const currentVersion = getSchemaVersion(db);

    return {
        currentVersion,
        pendingCount: migrations.filter((m) => m.version > currentVersion).length,
        migrations: migrations.map((m) => ({
            version: m.version,
            name: m.name,
            applied: m.version <= currentVersion,
        })),
    };
}

/**
 * CLI entry point for running migrations
 */
if (import.meta.main) {
    const args = process.argv.slice(2);
    const command = args[0] || "up";

    // Dynamic import to avoid circular dependency
    const { initDatabase } = await import("./database");
    const conn = initDatabase();

    try {
        switch (command) {
            case "up":
                runMigrations(conn.db);
                break;
            case "status":
                const status = getMigrationStatus(conn.db);
                console.log(`Current version: ${status.currentVersion}`);
                console.log(`Pending migrations: ${status.pendingCount}`);
                console.log("\nMigrations:");
                for (const m of status.migrations) {
                    console.log(`  [${m.applied ? "✓" : " "}] v${m.version}: ${m.name}`);
                }
                break;
            case "rollback":
                const targetVersion = parseInt(args[1] || "0", 10);
                rollbackTo(conn.db, targetVersion);
                break;
            default:
                console.log("Usage: bun run src/db/migrations.ts [up|status|rollback <version>]");
        }
    } finally {
        conn.close();
    }
}
