/**
 * Health check endpoint
 *
 * GET /health - Returns system health status and component states
 */

import { Hono } from "hono";
import { getAppContext } from "../../index";
import type { HealthResponse } from "../types/api.types";

const health = new Hono();

/**
 * GET /health
 * Returns health status of all system components
 */
health.get("/", async (c) => {
    const ctx = getAppContext();

    const response: HealthResponse = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        version: "0.1.0",
        components: {
            database: "healthy",
            canton: ctx.canton ? "connected" : "offline",
            eventProcessor: ctx.eventProcessor ? "running" : "stopped",
            settlementService: "running",
            reconciliation: ctx.reconciliationService ? "running" : "stopped",
        },
    };

    // Check Canton connectivity if available
    if (ctx.canton) {
        try {
            await ctx.canton.getLedgerEnd();
            response.components.canton = "connected";
        } catch (error) {
            response.components.canton = "error";
            response.status = "degraded";
            console.warn("[Health] Canton connectivity check failed:", error);
        }
    }

    // Check database by attempting a simple query
    try {
        // The repositories have access to the db, try a simple operation
        ctx.repositories.markets.getAllMarkets();
    } catch (error) {
        response.components.database = "unhealthy";
        response.status = "unhealthy";
        console.error("[Health] Database check failed:", error);
    }

    // Set appropriate HTTP status code
    const httpStatus = response.status === "healthy" ? 200 : 503;

    return c.json(response, httpStatus);
});

export { health };
