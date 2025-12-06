/**
 * Event processing types and configuration
 * Used by LedgerEventProcessor for Canton SSE streaming
 */

import type { LedgerOffset } from "../types/daml";

// ============================================
// Configuration
// ============================================

/** Event processor configuration */
export interface EventProcessorConfig {
    /** Initial reconnection delay in ms (default: 1000) */
    initialReconnectDelayMs: number;
    /** Maximum reconnection delay in ms (default: 30000) */
    maxReconnectDelayMs: number;
    /** Reconnect multiplier for exponential backoff (default: 2) */
    reconnectMultiplier: number;
}

/** Default configuration values */
export const DEFAULT_EVENT_PROCESSOR_CONFIG: EventProcessorConfig = {
    initialReconnectDelayMs: 1000,
    maxReconnectDelayMs: 30000,
    reconnectMultiplier: 2,
};

// ============================================
// Status Types
// ============================================

/** Event processor status for monitoring */
export interface EventProcessorStatus {
    /** Whether the processor is currently running */
    isRunning: boolean;
    /** Current ledger offset being processed */
    currentOffset: LedgerOffset | null;
    /** Time of last processed event */
    lastEventTime: Date | null;
    /** Number of reconnection attempts since last successful connection */
    reconnectAttempts: number;
    /** Total events processed since startup */
    eventsProcessed: number;
    /** Total errors encountered */
    errors: number;
}

// ============================================
// Template Parsing
// ============================================

/** Parsed template info from template ID */
export interface ParsedTemplateId {
    /** Package name (e.g., "pebble") */
    packageName: string;
    /** Module path (e.g., "Pebble.Account") */
    module: string;
    /** Template name (e.g., "TradingAccount") */
    template: string;
}

/**
 * Parse a template ID in format #package:Module.Path:Template
 * Returns null if the format is invalid
 */
export function parseTemplateId(templateId: string): ParsedTemplateId | null {
    // Format: #package-name:Module.Name:Template
    const match = templateId.match(/^#([^:]+):([^:]+):([^:]+)$/);
    if (!match) return null;

    return {
        packageName: match[1],
        module: match[2],
        template: match[3],
    };
}
