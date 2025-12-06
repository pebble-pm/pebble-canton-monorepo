/**
 * Matching module exports
 *
 * This module provides the off-chain order matching infrastructure:
 * - InMemoryOrderBook: Per-market orderbook data structure
 * - MatchingEngine: Price-time priority matching with binary market support
 * - OrderbookPersistence: Crash recovery via SQLite persistence
 */

export { InMemoryOrderBook } from "./orderbook";
export { MatchingEngine } from "./engine";
export type { MatchResult } from "./engine";
export { OrderbookPersistence } from "./persistence";
export type { RehydrationResult } from "./persistence";
