/**
 * Main entry point for Pebble backend
 * Initializes all services and starts the server
 */

import { unlinkSync, existsSync } from "node:fs";
import Decimal from "decimal.js";
import { getConfig, type PebbleConfig } from "./config";
import { initDatabase, type DatabaseConnection } from "./db/database";
import { createCantonClient, type CantonLedgerClient } from "./canton/client";
import { ConnectionError } from "./canton/types";
import { bootstrapTestParties, shouldBootstrap } from "./canton/party-bootstrap";
import {
    MarketRepository,
    OrderRepository,
    TradeRepository,
    AccountRepository,
    PositionRepository,
    SettlementRepository,
} from "./db/repositories";
import { MatchingEngine, OrderbookPersistence } from "./matching";
import { OrderService, SettlementService, ReconciliationService } from "./services";
// Phase 6: Event Processing & Projections
import { LedgerEventProcessor } from "./events";
import { BalanceProjectionService, PositionProjectionService, MarketProjectionService } from "./projections";
// Phase 7: API Layer
import { app, wsManager, websocketHandlers, stopRateLimitCleanup } from "./api";

// ============================================
// Application Context
// ============================================

export interface AppContext {
    config: PebbleConfig;
    db: DatabaseConnection;
    canton: CantonLedgerClient | null;
    repositories: {
        markets: MarketRepository;
        orders: OrderRepository;
        trades: TradeRepository;
        accounts: AccountRepository;
        positions: PositionRepository;
        settlements: SettlementRepository;
    };
    // Phase 4: Matching Engine & Order Service
    matchingEngine: MatchingEngine;
    orderService: OrderService;
    // Phase 5: Settlement Service
    settlementService: SettlementService;
    // Phase 6: Event Processing & Projections
    eventProcessor: LedgerEventProcessor | null;
    projections: {
        balance: BalanceProjectionService;
        position: PositionProjectionService;
        market: MarketProjectionService;
    };
    reconciliationService: ReconciliationService | null;
    // Phase 7: HTTP Server
    server?: ReturnType<typeof Bun.serve>;
}

// Global app context (for service access)
let appContext: AppContext | null = null;

export function getAppContext(): AppContext {
    if (!appContext) {
        throw new Error("Application not initialized");
    }
    return appContext;
}

// ============================================
// Timestamped Logging
// ============================================

function enableTimestampedLogging(): void {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    const formatTimestamp = (): string => {
        const now = new Date();
        return now.toISOString().slice(11, 23); // HH:mm:ss.SSS
    };

    console.log = (...args: unknown[]) => {
        originalLog(`[${formatTimestamp()}]`, ...args);
    };

    console.error = (...args: unknown[]) => {
        originalError(`[${formatTimestamp()}]`, ...args);
    };

    console.warn = (...args: unknown[]) => {
        originalWarn(`[${formatTimestamp()}]`, ...args);
    };
}

// ============================================
// Command Line Arguments
// ============================================

interface StartupOptions {
    fresh: boolean;
}

function parseArgs(): StartupOptions {
    const args = process.argv.slice(2);
    return {
        fresh: args.includes("--fresh"),
    };
}

/**
 * Delete SQLite database files for a fresh start
 */
function resetDatabase(dbPath: string): void {
    const filesToDelete = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];

    let deletedAny = false;
    for (const file of filesToDelete) {
        if (existsSync(file)) {
            unlinkSync(file);
            deletedAny = true;
        }
    }

    if (deletedAny) {
        console.log(`[Database] Deleted existing database at ${dbPath}`);
    }
}

// ============================================
// Initialization
// ============================================

async function initializeApp(options: StartupOptions): Promise<AppContext> {
    const config = getConfig();

    console.log("=".repeat(50));
    console.log("  Pebble Backend - Starting...");
    console.log("=".repeat(50));
    console.log(`  Environment: ${config.env}`);
    console.log(`  Server: ${config.host}:${config.port}`);
    if (options.fresh) {
        console.log("  Mode: FRESH (database will be reset)");
    }
    console.log("");

    // Reset database if --fresh flag is provided
    if (options.fresh) {
        resetDatabase(config.database.path);
    }

    // Configure Decimal.js for financial calculations
    Decimal.set({
        precision: config.decimal.precision,
        rounding: config.decimal.rounding as Decimal.Rounding,
    });
    console.log(`[Decimal] Configured with precision=${config.decimal.precision}`);

    // Initialize database
    const db = initDatabase();
    console.log(`[Database] Initialized at ${config.database.path}`);

    // Create repositories
    const repositories = {
        markets: new MarketRepository(db.db),
        orders: new OrderRepository(db.db),
        trades: new TradeRepository(db.db),
        accounts: new AccountRepository(db.db),
        positions: new PositionRepository(db.db),
        settlements: new SettlementRepository(db.db),
    };
    console.log("[Repositories] All repositories initialized");

    // Initialize matching engine and persistence
    const matchingEngine = new MatchingEngine();
    const orderbookPersistence = new OrderbookPersistence(repositories.orders);
    console.log("[MatchingEngine] Initialized");

    // Connect to Canton
    let canton: CantonLedgerClient | null = null;
    try {
        canton = await createCantonClient({
            host: config.canton.host,
            port: config.canton.port,
            useTls: config.canton.useTls,
            jwtToken: config.canton.jwtToken,
        });
        console.log(`[Canton] Connected to ${config.canton.host}:${config.canton.port}`);

        // Fetch parties and update config
        const parties = await canton.getParties();
        console.log(`[Canton] Found ${parties.length} parties`);

        const pebbleAdmin = parties.find((p) => p.party.startsWith("PebbleAdmin"));
        const oracle = parties.find((p) => p.party.startsWith("Oracle"));

        if (pebbleAdmin) {
            config.parties.pebbleAdmin = pebbleAdmin.party;
            console.log(`[Canton] PebbleAdmin: ${pebbleAdmin.party.slice(0, 30)}...`);
        } else {
            console.warn("[Canton] WARNING: PebbleAdmin party not found");
        }

        if (oracle) {
            config.parties.oracle = oracle.party;
            console.log(`[Canton] Oracle: ${oracle.party.slice(0, 30)}...`);
        } else {
            console.warn("[Canton] WARNING: Oracle party not found");
        }

        // Bootstrap test parties (Alice, Bob, Charlie) if enabled
        if (shouldBootstrap() && config.parties.pebbleAdmin) {
            console.log("[PartyBootstrap] Bootstrapping test parties...");
            const bootstrapResult = await bootstrapTestParties(canton, repositories.accounts, {
                pebbleAdminParty: config.parties.pebbleAdmin,
            });
            if (bootstrapResult.partiesCreated.length > 0) {
                console.log(`[PartyBootstrap] Created: ${bootstrapResult.partiesCreated.join(", ")}`);
            }
            if (bootstrapResult.partiesSkipped.length > 0) {
                console.log(`[PartyBootstrap] Skipped (already exist): ${bootstrapResult.partiesSkipped.join(", ")}`);
            }
            if (bootstrapResult.errors.length > 0) {
                console.warn(`[PartyBootstrap] Errors: ${bootstrapResult.errors.join("; ")}`);
            }
        }
    } catch (error) {
        if (error instanceof ConnectionError) {
            console.warn(`[Canton] Connection failed: ${error.message}`);
            console.warn("[Canton] Continuing in OFFLINE mode (Canton unavailable)");
        } else {
            throw error;
        }
    }

    // Initialize OrderService
    const orderService = new OrderService(
        canton,
        matchingEngine,
        orderbookPersistence,
        repositories.orders,
        repositories.trades,
        repositories.accounts,
        repositories.positions,
        repositories.markets,
        repositories.settlements,
        {
            pebbleAdminParty: config.parties.pebbleAdmin,
        },
    );

    // Rehydrate orderbook from database
    orderService.initialize();
    console.log("[OrderService] Initialized and orderbook rehydrated");

    // Initialize SettlementService
    const settlementService = new SettlementService(
        canton,
        repositories.trades,
        repositories.settlements,
        repositories.accounts,
        repositories.positions,
        repositories.markets,
        {
            pebbleAdminParty: config.parties.pebbleAdmin,
            batchIntervalMs: config.settlement.batchIntervalMs,
            maxBatchSize: config.settlement.maxBatchSize,
            maxRetries: config.settlement.maxRetries,
            proposalTimeoutMs: config.settlement.proposalTimeoutMs,
            roundDelayMs: config.settlement.roundDelayMs,
        },
    );
    settlementService.initialize();
    console.log("[SettlementService] Initialized");

    // Phase 6: Initialize projection services
    const projections = {
        balance: new BalanceProjectionService(db.db),
        position: new PositionProjectionService(db.db),
        market: new MarketProjectionService(db.db),
    };
    console.log("[Projections] All projection services initialized");

    // Phase 6: Initialize event processor (only if Canton is available)
    let eventProcessor: LedgerEventProcessor | null = null;
    if (canton) {
        eventProcessor = new LedgerEventProcessor(
            canton,
            db.db,
            projections.balance,
            projections.position,
            projections.market,
            config.eventProcessor,
        );
        // Start in background (non-blocking)
        eventProcessor.start().catch((error) => {
            console.error("[EventProcessor] Fatal error:", error);
        });
        console.log("[EventProcessor] Started");
    } else {
        console.log("[EventProcessor] Skipped (Canton offline)");
    }

    // Phase 6: Initialize reconciliation service
    let reconciliationService: ReconciliationService | null = null;
    if (canton) {
        reconciliationService = new ReconciliationService(canton, db.db, projections.balance, {
            intervalMs: config.reconciliation.intervalMs,
            staleThresholdMinutes: config.reconciliation.staleThresholdMinutes,
            driftTolerancePercentage: config.reconciliation.driftTolerancePercentage,
            pebbleAdminParty: config.parties.pebbleAdmin,
        });
        reconciliationService.start();
        console.log("[ReconciliationService] Started");
    } else {
        console.log("[ReconciliationService] Skipped (Canton offline)");
    }

    return {
        config,
        db,
        canton,
        repositories,
        matchingEngine,
        orderService,
        settlementService,
        eventProcessor,
        projections,
        reconciliationService,
    };
}

// ============================================
// Graceful Shutdown
// ============================================

function setupGracefulShutdown(context: AppContext): void {
    const shutdown = async (signal: string) => {
        console.log(`\n[Shutdown] Received ${signal}, cleaning up...`);

        // Stop HTTP server first (stop accepting new requests)
        if (context.server) {
            context.server.stop();
            console.log("[Shutdown] HTTP server stopped");
        }

        // Close WebSocket connections
        wsManager.shutdown();
        console.log("[Shutdown] WebSocket connections closed");

        // Stop rate limit cleanup interval
        stopRateLimitCleanup();

        // Stop event processor (stop receiving new events)
        if (context.eventProcessor) {
            context.eventProcessor.stop();
            console.log("[Shutdown] Event processor stopped");
        }

        // Stop reconciliation service
        if (context.reconciliationService) {
            context.reconciliationService.stop();
            console.log("[Shutdown] Reconciliation service stopped");
        }

        // Shutdown settlement service (wait for pending batches)
        try {
            await context.settlementService.shutdown();
            console.log("[Shutdown] Settlement service stopped");
        } catch (error) {
            console.error("[Shutdown] Error stopping settlement service:", error);
        }

        // Close database last
        try {
            context.db.close();
            console.log("[Shutdown] Database closed");
        } catch (error) {
            console.error("[Shutdown] Error closing database:", error);
        }

        console.log("[Shutdown] Goodbye!");
        process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// ============================================
// Main
// ============================================

async function main() {
    try {
        const options = parseArgs();
        appContext = await initializeApp(options);
        setupGracefulShutdown(appContext);

        // Start HTTP/WebSocket server
        const server = Bun.serve({
            port: appContext.config.port,
            hostname: appContext.config.host,
            fetch: app.fetch,
            websocket: websocketHandlers,
        });

        appContext.server = server;

        console.log("");
        console.log("=".repeat(50));
        console.log("  Pebble Backend - Ready");
        console.log("=".repeat(50));
        console.log("");
        console.log("  Components initialized:");
        console.log("    - Configuration loaded");
        console.log("    - SQLite database ready");
        console.log("    - Repository layer ready");
        console.log(appContext.canton ? "    - Canton client connected" : "    - Canton client OFFLINE");
        console.log("    - Matching engine ready");
        console.log("    - Order service ready");
        console.log("    - Settlement service ready");
        console.log(appContext.eventProcessor ? "    - Event processor streaming" : "    - Event processor OFFLINE");
        console.log("    - Projection services ready");
        console.log(appContext.reconciliationService ? "    - Reconciliation service running" : "    - Reconciliation service OFFLINE");
        console.log(`    - HTTP server listening on ${server.hostname}:${server.port}`);
        console.log(`    - WebSocket available at ws://${server.hostname}:${server.port}/api/ws`);
        console.log("");
        console.log("  API Endpoints:");
        console.log("    GET  /health              - Health check");
        console.log("    GET  /api/markets         - List markets");
        console.log("    GET  /api/markets/:id     - Market detail");
        console.log("    POST /api/markets         - Create market (admin)");
        console.log("    GET  /api/orders          - List orders");
        console.log("    POST /api/orders          - Place order");
        console.log("    GET  /api/positions       - List positions");
        console.log("    GET  /api/account         - Account info");
        console.log("");
        console.log("Press Ctrl+C to stop");

        // Enable timestamps for all subsequent log messages
        enableTimestampedLogging();
    } catch (error) {
        console.error("Fatal error during initialization:", error);
        process.exit(1);
    }
}

// Run main
main();
