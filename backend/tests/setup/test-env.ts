/**
 * Test environment setup for Pebble backend tests
 *
 * Configures:
 * - Decimal.js settings
 * - Test database (in-memory SQLite)
 * - Mock Canton client for unit tests
 * - Real Canton client for integration tests
 */

import Decimal from "decimal.js";
import { resetConfig, loadConfig, type PebbleConfig } from "../../src/config";

// Configure Decimal.js for tests (same as production)
Decimal.set({
    precision: 20,
    rounding: Decimal.ROUND_HALF_UP,
});

/**
 * Test environment configuration
 */
export interface TestEnv {
    config: PebbleConfig;
    isIntegration: boolean;
}

/**
 * Setup test environment
 *
 * @param isIntegration Whether this is an integration test requiring real Canton
 */
export function setupTestEnv(isIntegration: boolean = false): TestEnv {
    // Reset any cached config
    resetConfig();

    // Set test environment variables
    process.env.NODE_ENV = "test";
    process.env.DATABASE_PATH = ":memory:";
    process.env.LOG_LEVEL = "error";

    // For integration tests, use real Canton settings
    if (isIntegration) {
        process.env.CANTON_HOST = process.env.TEST_CANTON_HOST ?? "localhost";
        process.env.CANTON_JSON_PORT = process.env.TEST_CANTON_PORT ?? "7575";
    }

    // Speed up settlement for tests
    process.env.SETTLEMENT_BATCH_INTERVAL_MS = "100";
    process.env.SETTLEMENT_MAX_BATCH_SIZE = "25";
    process.env.SETTLEMENT_MAX_RETRIES = "2";

    // Speed up reconciliation for tests
    process.env.RECONCILIATION_INTERVAL_MS = "1000";
    process.env.RECONCILIATION_STALE_THRESHOLD_MINUTES = "1";

    const config = loadConfig();

    return {
        config,
        isIntegration,
    };
}

/**
 * Cleanup test environment after tests
 */
export function cleanupTestEnv(): void {
    resetConfig();
}

/**
 * Wait for a condition to be true (useful for async operations)
 */
export async function waitFor(
    condition: () => boolean | Promise<boolean>,
    timeoutMs: number = 5000,
    intervalMs: number = 50,
): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        if (await condition()) {
            return;
        }
        await sleep(intervalMs);
    }

    throw new Error(`Condition not met within ${timeoutMs}ms`);
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a unique test ID (for markets, orders, etc.)
 */
export function testId(prefix: string = "test"): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Assert that a promise rejects with a specific error
 */
export async function expectReject(promise: Promise<unknown>, messageContains?: string): Promise<Error> {
    try {
        await promise;
        throw new Error("Expected promise to reject but it resolved");
    } catch (error) {
        if (error instanceof Error) {
            if (messageContains && !error.message.toLowerCase().includes(messageContains.toLowerCase())) {
                throw new Error(`Expected error containing "${messageContains}" but got "${error.message}"`);
            }
            return error;
        }
        throw error;
    }
}

/**
 * Create a deferred promise (useful for testing async flows)
 */
export function createDeferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
} {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;

    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}
