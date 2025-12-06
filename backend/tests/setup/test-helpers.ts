/**
 * Common test utilities and helpers for Pebble backend tests
 */

import Decimal from "decimal.js";
import { expect } from "bun:test";
import type { Order, Trade, OrderBook, OrderBookLevel } from "../../src/types";

// ============================================
// Decimal Comparison Helpers
// ============================================

/**
 * Compare two Decimal values for equality
 */
export function decimalEquals(a: Decimal, b: Decimal | number | string): boolean {
    return a.equals(new Decimal(b));
}

/**
 * Assert that two Decimal values are equal
 */
export function expectDecimalEquals(actual: Decimal, expected: Decimal | number | string, message?: string): void {
    const expectedDecimal = new Decimal(expected);
    if (!actual.equals(expectedDecimal)) {
        throw new Error(message ?? `Expected ${actual.toString()} to equal ${expectedDecimal.toString()}`);
    }
}

/**
 * Assert that a Decimal is approximately equal (within tolerance)
 */
export function expectDecimalApprox(
    actual: Decimal,
    expected: Decimal | number | string,
    tolerance: number = 0.0001,
    message?: string,
): void {
    const expectedDecimal = new Decimal(expected);
    const diff = actual.minus(expectedDecimal).abs();
    if (diff.gt(tolerance)) {
        throw new Error(
            message ??
                `Expected ${actual.toString()} to be approximately ${expectedDecimal.toString()} (diff: ${diff.toString()}, tolerance: ${tolerance})`,
        );
    }
}

/**
 * Assert that a Decimal is greater than another
 */
export function expectDecimalGt(actual: Decimal, expected: Decimal | number | string, message?: string): void {
    const expectedDecimal = new Decimal(expected);
    if (!actual.gt(expectedDecimal)) {
        throw new Error(message ?? `Expected ${actual.toString()} to be greater than ${expectedDecimal.toString()}`);
    }
}

/**
 * Assert that a Decimal is less than another
 */
export function expectDecimalLt(actual: Decimal, expected: Decimal | number | string, message?: string): void {
    const expectedDecimal = new Decimal(expected);
    if (!actual.lt(expectedDecimal)) {
        throw new Error(message ?? `Expected ${actual.toString()} to be less than ${expectedDecimal.toString()}`);
    }
}

// ============================================
// Order Comparison Helpers
// ============================================

/**
 * Assert order has expected status
 */
export function expectOrderStatus(order: Order, status: Order["status"]): void {
    expect(order.status).toBe(status);
}

/**
 * Assert order filled quantity matches expected
 */
export function expectOrderFilled(order: Order, filledQuantity: number | string): void {
    expectDecimalEquals(order.filledQuantity, filledQuantity, `Order ${order.orderId} filled quantity mismatch`);
}

/**
 * Assert order remaining quantity matches expected
 */
export function expectOrderRemaining(order: Order, remainingQuantity: number | string): void {
    const remaining = order.quantity.minus(order.filledQuantity);
    expectDecimalEquals(remaining, remainingQuantity, `Order ${order.orderId} remaining quantity mismatch`);
}

// ============================================
// Trade Comparison Helpers
// ============================================

/**
 * Assert trade details match expected values
 */
export function expectTrade(
    trade: Trade,
    expected: {
        buyerId?: string;
        sellerId?: string;
        side?: Trade["side"];
        price?: number | string;
        quantity?: number | string;
        tradeType?: Trade["tradeType"];
    },
): void {
    if (expected.buyerId !== undefined) {
        expect(trade.buyerId).toBe(expected.buyerId);
    }
    if (expected.sellerId !== undefined) {
        expect(trade.sellerId).toBe(expected.sellerId);
    }
    if (expected.side !== undefined) {
        expect(trade.side).toBe(expected.side);
    }
    if (expected.price !== undefined) {
        expectDecimalEquals(trade.price, expected.price, "Trade price mismatch");
    }
    if (expected.quantity !== undefined) {
        expectDecimalEquals(trade.quantity, expected.quantity, "Trade quantity mismatch");
    }
    if (expected.tradeType !== undefined) {
        expect(trade.tradeType).toBe(expected.tradeType);
    }
}

// ============================================
// OrderBook Comparison Helpers
// ============================================

/**
 * Assert orderbook level matches expected values
 */
export function expectOrderBookLevel(
    level: OrderBookLevel,
    expected: {
        price?: number | string;
        quantity?: number | string;
        orderCount?: number;
    },
): void {
    if (expected.price !== undefined) {
        expectDecimalEquals(level.price, expected.price, "Level price mismatch");
    }
    if (expected.quantity !== undefined) {
        expectDecimalEquals(level.quantity, expected.quantity, "Level quantity mismatch");
    }
    if (expected.orderCount !== undefined) {
        expect(level.orderCount).toBe(expected.orderCount);
    }
}

/**
 * Get best bid price from orderbook
 */
export function getBestBid(book: OrderBook, side: "yes" | "no"): Decimal | null {
    const bids = side === "yes" ? book.yes.bids : book.no.bids;
    return bids.length > 0 ? bids[0].price : null;
}

/**
 * Get best ask price from orderbook
 */
export function getBestAsk(book: OrderBook, side: "yes" | "no"): Decimal | null {
    const asks = side === "yes" ? book.yes.asks : book.no.asks;
    return asks.length > 0 ? asks[0].price : null;
}

/**
 * Get spread between best bid and best ask
 */
export function getSpread(book: OrderBook, side: "yes" | "no"): Decimal | null {
    const bestBid = getBestBid(book, side);
    const bestAsk = getBestAsk(book, side);

    if (bestBid === null || bestAsk === null) {
        return null;
    }

    return bestAsk.minus(bestBid);
}

/**
 * Assert orderbook is empty
 */
export function expectEmptyOrderBook(book: OrderBook): void {
    expect(book.yes.bids.length).toBe(0);
    expect(book.yes.asks.length).toBe(0);
    expect(book.no.bids.length).toBe(0);
    expect(book.no.asks.length).toBe(0);
}

// ============================================
// Timing Helpers
// ============================================

/**
 * Create orders with specific time ordering
 */
export function withTimeOffset(date: Date, offsetMs: number): Date {
    return new Date(date.getTime() + offsetMs);
}

/**
 * Measure execution time of an async function
 */
export async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
    const start = performance.now();
    const result = await fn();
    const durationMs = performance.now() - start;
    return { result, durationMs };
}

/**
 * Run a function multiple times and return statistics
 */
export async function benchmark<T>(
    fn: () => Promise<T>,
    iterations: number = 100,
): Promise<{
    results: T[];
    durations: number[];
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
}> {
    const results: T[] = [];
    const durations: number[] = [];

    for (let i = 0; i < iterations; i++) {
        const { result, durationMs } = await measureTime(fn);
        results.push(result);
        durations.push(durationMs);
    }

    // Sort for percentile calculations
    const sortedDurations = [...durations].sort((a, b) => a - b);

    return {
        results,
        durations,
        min: sortedDurations[0],
        max: sortedDurations[sortedDurations.length - 1],
        avg: durations.reduce((a, b) => a + b, 0) / durations.length,
        p50: sortedDurations[Math.floor(iterations * 0.5)],
        p95: sortedDurations[Math.floor(iterations * 0.95)],
        p99: sortedDurations[Math.floor(iterations * 0.99)],
    };
}

// ============================================
// Mock Helpers
// ============================================

/**
 * Create a mock function that tracks calls
 */
export function createMockFn<T extends (...args: unknown[]) => unknown>(): T & {
    calls: Parameters<T>[];
    results: ReturnType<T>[];
    mockReturnValue: (value: ReturnType<T>) => void;
    mockImplementation: (impl: T) => void;
    reset: () => void;
} {
    let returnValue: ReturnType<T> | undefined;
    let implementation: T | undefined;
    const calls: Parameters<T>[] = [];
    const results: ReturnType<T>[] = [];

    const mockFn = ((...args: Parameters<T>) => {
        calls.push(args);
        let result: ReturnType<T>;
        if (implementation) {
            result = implementation(...args) as ReturnType<T>;
        } else {
            result = returnValue as ReturnType<T>;
        }
        results.push(result);
        return result;
    }) as T & {
        calls: Parameters<T>[];
        results: ReturnType<T>[];
        mockReturnValue: (value: ReturnType<T>) => void;
        mockImplementation: (impl: T) => void;
        reset: () => void;
    };

    mockFn.calls = calls;
    mockFn.results = results;
    mockFn.mockReturnValue = (value: ReturnType<T>) => {
        returnValue = value;
    };
    mockFn.mockImplementation = (impl: T) => {
        implementation = impl;
    };
    mockFn.reset = () => {
        calls.length = 0;
        results.length = 0;
        returnValue = undefined;
        implementation = undefined;
    };

    return mockFn;
}
