/**
 * Logging utilities for Pebble backend
 *
 * Provides consistent, timestamped logging with context for:
 * - Ledger/Canton operations
 * - General application events
 */

// ============================================
// Timestamp Helper
// ============================================

/**
 * Get current timestamp in HH:mm:ss.SSS format
 */
function getTimestamp(): string {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, "0");
    const minutes = now.getMinutes().toString().padStart(2, "0");
    const seconds = now.getSeconds().toString().padStart(2, "0");
    const millis = now.getMilliseconds().toString().padStart(3, "0");
    return `${hours}:${minutes}:${seconds}.${millis}`;
}

/**
 * Truncate a string (like contractId or partyId) for display
 */
function truncate(str: string | undefined, maxLen: number = 20): string {
    if (!str) return "n/a";
    if (str.length <= maxLen) return str;
    return `${str.slice(0, maxLen)}...`;
}

// ============================================
// Ledger Action Logging
// ============================================

export type LedgerAction = "CREATE" | "EXERCISE" | "QUERY" | "STREAM" | "EVENT";

export interface LedgerLogContext {
    party?: string;
    contractId?: string;
    templateId?: string;
    choice?: string;
    marketId?: string;
    userId?: string;
    amount?: string;
    [key: string]: string | undefined;
}

/**
 * Log a ledger action (before execution)
 *
 * Format: [HH:mm:ss.SSS] [LEDGER:ACTION] Template | context | phase
 *
 * @example
 * logLedgerSubmit("CREATE", "TradingAccount", { party: "Alice::1220..." })
 * // [14:32:05.123] [LEDGER:CREATE] TradingAccount | party=Alice::1220... | submitting
 */
export function logLedgerSubmit(action: LedgerAction, template: string, context?: LedgerLogContext): void {
    const timestamp = getTimestamp();
    const contextStr = formatContext(context);
    console.log(`[${timestamp}] [LEDGER:${action}] ${template} | ${contextStr} | submitting`);
}

/**
 * Log a successful ledger action
 *
 * @example
 * logLedgerSuccess("CREATE", "TradingAccount", "txId123", "contractId456", { party: "Alice" })
 * // [14:32:05.456] [LEDGER:CREATE] TradingAccount | party=Alice | SUCCESS txId=txId123 contractId=contractId456
 */
export function logLedgerSuccess(
    action: LedgerAction,
    template: string,
    txId?: string,
    contractId?: string,
    context?: LedgerLogContext,
): void {
    const timestamp = getTimestamp();
    const contextStr = formatContext(context);
    const resultParts: string[] = ["SUCCESS"];
    if (txId) resultParts.push(`txId=${truncate(txId)}`);
    if (contractId) resultParts.push(`contractId=${truncate(contractId)}`);
    console.log(`[${timestamp}] [LEDGER:${action}] ${template} | ${contextStr} | ${resultParts.join(" ")}`);
}

/**
 * Log a failed ledger action
 *
 * @example
 * logLedgerError("CREATE", "TradingAccount", new Error("Connection refused"), { party: "Alice" })
 * // [14:32:05.789] [LEDGER:CREATE] TradingAccount | party=Alice | ERROR: Connection refused
 */
export function logLedgerError(action: LedgerAction, template: string, error: unknown, context?: LedgerLogContext): void {
    const timestamp = getTimestamp();
    const contextStr = formatContext(context);
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[${timestamp}] [LEDGER:${action}] ${template} | ${contextStr} | ERROR: ${errorMsg}`);
}

/**
 * Log a ledger event received from stream
 *
 * @example
 * logLedgerEvent("created", "TradingAccount", "contractId123", { party: "Alice" })
 * // [14:32:06.123] [LEDGER:EVENT] TradingAccount | party=Alice | created contractId=contractId123
 */
export function logLedgerEvent(eventType: "created" | "archived", template: string, contractId: string, context?: LedgerLogContext): void {
    const timestamp = getTimestamp();
    const contextStr = formatContext(context);
    console.log(`[${timestamp}] [LEDGER:EVENT] ${template} | ${contextStr} | ${eventType} contractId=${truncate(contractId)}`);
}

/**
 * Format context object into key=value string
 */
function formatContext(context?: LedgerLogContext): string {
    if (!context) return "no-context";

    const parts: string[] = [];
    for (const [key, value] of Object.entries(context)) {
        if (value !== undefined) {
            // Truncate long values like partyIds and contractIds
            const displayValue = value.length > 25 ? truncate(value, 20) : value;
            parts.push(`${key}=${displayValue}`);
        }
    }

    return parts.length > 0 ? parts.join(" ") : "no-context";
}

// ============================================
// General Application Logging
// ============================================

/**
 * Log an application event with timestamp
 *
 * @example
 * logApp("OrderService", "Order placed", { orderId: "123", userId: "Alice" })
 * // [14:32:07.456] [OrderService] Order placed | orderId=123 userId=Alice
 */
export function logApp(component: string, message: string, context?: Record<string, string | number | boolean | undefined>): void {
    const timestamp = getTimestamp();
    if (context) {
        const contextStr = Object.entries(context)
            .filter(([_, v]) => v !== undefined)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ");
        console.log(`[${timestamp}] [${component}] ${message} | ${contextStr}`);
    } else {
        console.log(`[${timestamp}] [${component}] ${message}`);
    }
}

/**
 * Log an application error with timestamp
 */
export function logAppError(
    component: string,
    message: string,
    error?: unknown,
    context?: Record<string, string | number | boolean | undefined>,
): void {
    const timestamp = getTimestamp();
    const errorMsg = error instanceof Error ? error.message : error ? String(error) : "";

    if (context) {
        const contextStr = Object.entries(context)
            .filter(([_, v]) => v !== undefined)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ");
        console.error(`[${timestamp}] [${component}] ERROR: ${message} | ${contextStr}${errorMsg ? ` | ${errorMsg}` : ""}`);
    } else {
        console.error(`[${timestamp}] [${component}] ERROR: ${message}${errorMsg ? ` | ${errorMsg}` : ""}`);
    }
}

/**
 * Log a warning with timestamp
 */
export function logAppWarn(component: string, message: string, context?: Record<string, string | number | boolean | undefined>): void {
    const timestamp = getTimestamp();
    if (context) {
        const contextStr = Object.entries(context)
            .filter(([_, v]) => v !== undefined)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ");
        console.warn(`[${timestamp}] [${component}] WARN: ${message} | ${contextStr}`);
    } else {
        console.warn(`[${timestamp}] [${component}] WARN: ${message}`);
    }
}

// ============================================
// WebSocket Logging
// ============================================

/**
 * Log a WebSocket broadcast
 *
 * @example
 * logWsBroadcast("trades:market-123", "trade:executed", { tradeId: "t1" })
 * // [14:32:08.123] [WS:BROADCAST] trades:market-123 | trade:executed | tradeId=t1
 */
export function logWsBroadcast(channel: string, event: string, context?: Record<string, string | number | boolean | undefined>): void {
    const timestamp = getTimestamp();
    if (context) {
        const contextStr = Object.entries(context)
            .filter(([_, v]) => v !== undefined)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ");
        console.log(`[${timestamp}] [WS:BROADCAST] ${channel} | ${event} | ${contextStr}`);
    } else {
        console.log(`[${timestamp}] [WS:BROADCAST] ${channel} | ${event}`);
    }
}

/**
 * Log a WebSocket message sent to specific user
 *
 * @example
 * logWsUserMessage("Alice::123", "orders", "order:created", { orderId: "o1" })
 * // [14:32:08.456] [WS:USER] Alice::123... | orders | order:created | orderId=o1
 */
export function logWsUserMessage(
    userId: string,
    channel: string,
    event: string,
    context?: Record<string, string | number | boolean | undefined>,
): void {
    const timestamp = getTimestamp();
    const userDisplay = truncate(userId, 15);
    if (context) {
        const contextStr = Object.entries(context)
            .filter(([_, v]) => v !== undefined)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ");
        console.log(`[${timestamp}] [WS:USER] ${userDisplay} | ${channel} | ${event} | ${contextStr}`);
    } else {
        console.log(`[${timestamp}] [WS:USER] ${userDisplay} | ${channel} | ${event}`);
    }
}
