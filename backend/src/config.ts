/**
 * Environment configuration for Pebble backend
 * Loads from environment variables with sensible defaults for development
 */

export interface PebbleConfig {
    // Server configuration
    port: number;
    host: string;
    env: "development" | "production" | "test";

    // Canton Ledger API configuration
    canton: {
        host: string;
        port: number; // JSON Ledger API v2 port (7575)
        grpcPort: number; // gRPC Ledger API port (6865)
        adminPort: number; // Admin API port (6866)
        useTls: boolean;
        jwtToken?: string; // For production authentication
    };

    // Party identifiers (loaded from Canton on startup)
    parties: {
        pebbleAdmin: string;
        oracle: string;
    };

    // Database configuration
    database: {
        path: string; // SQLite file path
        walMode: boolean; // Write-Ahead Logging for better concurrency
    };

    // Admin authentication
    adminKey: string;

    // Decimal.js configuration
    decimal: {
        precision: number;
        rounding: number; // ROUND_HALF_UP = 4
    };

    // Settlement service configuration
    settlement: {
        batchIntervalMs: number; // Batch processing interval (default: 2000)
        maxBatchSize: number; // Max trades per batch (default: 25)
        maxRetries: number; // Max retry attempts (default: 3)
        proposalTimeoutMs: number; // Proposal timeout (default: 300000 = 5 min)
        roundDelayMs: number; // Delay between settlement rounds (default: 50)
    };

    // Event processor configuration (Phase 6)
    eventProcessor: {
        initialReconnectDelayMs: number; // Initial reconnect delay (default: 1000)
        maxReconnectDelayMs: number; // Max reconnect delay (default: 30000)
        reconnectMultiplier: number; // Exponential backoff multiplier (default: 2)
    };

    // Reconciliation service configuration (Phase 6)
    reconciliation: {
        intervalMs: number; // How often to run (default: 60000 = 1 minute)
        staleThresholdMinutes: number; // Stale account threshold (default: 5)
        driftTolerancePercentage: number; // Drift tolerance (default: 0.001 = 0.1%)
    };
}

function getEnvString(key: string, defaultValue: string): string {
    return process.env[key] ?? defaultValue;
}

function getEnvNumber(key: string, defaultValue: number): number {
    const value = process.env[key];
    return value ? parseInt(value, 10) : defaultValue;
}

function getEnvFloat(key: string, defaultValue: number): number {
    const value = process.env[key];
    return value ? parseFloat(value) : defaultValue;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];
    if (!value) return defaultValue;
    return value.toLowerCase() === "true";
}

export function loadConfig(): PebbleConfig {
    const env = getEnvString("NODE_ENV", "development") as PebbleConfig["env"];

    return {
        port: getEnvNumber("PORT", 3000),
        host: getEnvString("HOST", "0.0.0.0"),
        env,

        canton: {
            host: getEnvString("CANTON_HOST", "localhost"),
            port: getEnvNumber("CANTON_JSON_PORT", 7575),
            grpcPort: getEnvNumber("CANTON_GRPC_PORT", 6865),
            adminPort: getEnvNumber("CANTON_ADMIN_PORT", 6866),
            useTls: getEnvBoolean("CANTON_USE_TLS", false),
            jwtToken: process.env.CANTON_JWT_TOKEN,
        },

        parties: {
            // These are loaded dynamically from Canton on startup
            // Empty strings as placeholders
            pebbleAdmin: getEnvString("PEBBLE_ADMIN_PARTY", ""),
            oracle: getEnvString("ORACLE_PARTY", ""),
        },

        database: {
            path: getEnvString("DATABASE_PATH", "./pebble.db"),
            walMode: getEnvBoolean("DATABASE_WAL_MODE", true),
        },

        adminKey: getEnvString("ADMIN_KEY", "dev-admin-key-change-in-prod"),

        decimal: {
            precision: 20,
            rounding: 4, // ROUND_HALF_UP
        },

        settlement: {
            batchIntervalMs: getEnvNumber("SETTLEMENT_BATCH_INTERVAL_MS", 2000),
            maxBatchSize: getEnvNumber("SETTLEMENT_MAX_BATCH_SIZE", 25),
            maxRetries: getEnvNumber("SETTLEMENT_MAX_RETRIES", 3),
            proposalTimeoutMs: getEnvNumber("SETTLEMENT_PROPOSAL_TIMEOUT_MS", 300000),
            roundDelayMs: getEnvNumber("SETTLEMENT_ROUND_DELAY_MS", 50),
        },

        eventProcessor: {
            initialReconnectDelayMs: getEnvNumber("EVENT_PROCESSOR_INITIAL_RECONNECT_MS", 1000),
            maxReconnectDelayMs: getEnvNumber("EVENT_PROCESSOR_MAX_RECONNECT_MS", 30000),
            reconnectMultiplier: getEnvNumber("EVENT_PROCESSOR_RECONNECT_MULTIPLIER", 2),
        },

        reconciliation: {
            intervalMs: getEnvNumber("RECONCILIATION_INTERVAL_MS", 60000),
            staleThresholdMinutes: getEnvNumber("RECONCILIATION_STALE_THRESHOLD_MINUTES", 5),
            driftTolerancePercentage: getEnvFloat("RECONCILIATION_DRIFT_TOLERANCE", 0.001),
        },
    };
}

// Singleton config instance
let configInstance: PebbleConfig | null = null;

export function getConfig(): PebbleConfig {
    if (!configInstance) {
        configInstance = loadConfig();
    }
    return configInstance;
}

// For testing - reset config
export function resetConfig(): void {
    configInstance = null;
}
