/**
 * Orderbook Persistence Layer
 *
 * Handles crash recovery by persisting open orders to SQLite
 * and rehydrating the orderbook on startup.
 *
 * Safety features:
 * - Excludes orders with pending/settling trades from rehydration
 * - Logs excluded orders for manual review
 * - Maintains time priority during rehydration
 */

import type { Order, OrderStatus } from "../types";
import type { OrderRepository } from "../db/repositories/order.repository";
import type { MatchingEngine } from "./engine";
import Decimal from "decimal.js";

export class OrderbookPersistence {
    constructor(private orderRepo: OrderRepository) {}

    /**
     * Persist an order when it's added to the orderbook
     */
    persistOrder(order: Order): void {
        this.orderRepo.create(order);
    }

    /**
     * Update order status in the database
     */
    updateOrderStatus(orderId: string, status: OrderStatus, filledQuantity: Decimal): void {
        this.orderRepo.updateFilled(orderId, filledQuantity, status);
    }

    /**
     * Load all open orders from the database
     */
    loadOpenOrders(marketId?: string): Order[] {
        return this.orderRepo.getOpenOrders(marketId);
    }

    /**
     * Get order IDs that have pending/settling trades
     * These orders should NOT be rehydrated to avoid double-settlement
     */
    getOrdersWithPendingSettlements(): Set<string> {
        const orderIds = this.orderRepo.getOrdersWithPendingSettlements();
        return new Set(orderIds);
    }

    /**
     * Rehydrate the orderbook from persisted state
     *
     * SAFETY: This method handles crash recovery by:
     * 1. Loading open orders from the database
     * 2. Excluding orders that have trades in "settling" or "pending" status
     *    (these trades may have already been submitted to Canton)
     * 3. Sorting by createdAt to maintain time priority
     * 4. Adding directly to the orderbook WITHOUT re-matching
     *
     * Orders with pending settlements are logged for manual review.
     * The settlement service should retry failed settlements on startup.
     */
    rehydrateOrderbook(engine: MatchingEngine): RehydrationResult {
        const openOrders = this.loadOpenOrders();
        const ordersWithPendingSettlements = this.getOrdersWithPendingSettlements();

        console.log(`[Orderbook Rehydration] Found ${openOrders.length} open orders`);
        console.log(`[Orderbook Rehydration] ${ordersWithPendingSettlements.size} orders have pending settlements (excluded)`);

        // Track excluded orders for the result
        const excludedOrders: Order[] = [];
        const restoredOrders: Order[] = [];

        // Filter out orders that have pending settlements
        const safeOrders = openOrders.filter((order) => {
            if (ordersWithPendingSettlements.has(order.orderId)) {
                console.warn(
                    `[Orderbook Rehydration] Excluding order ${order.orderId} - has pending settlement. ` +
                        `Market: ${order.marketId}, User: ${order.userId}, ` +
                        `Side: ${order.side} ${order.action}, Qty: ${order.quantity.minus(order.filledQuantity)}`,
                );
                excludedOrders.push(order);
                return false;
            }
            return true;
        });

        // Sort by creation time to maintain time priority
        safeOrders.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

        // Add orders directly to the orderbook (no re-matching)
        for (const order of safeOrders) {
            engine.addOrderToBook(order);
            restoredOrders.push(order);
        }

        console.log(`[Orderbook Rehydration] Complete: ${restoredOrders.length} orders restored`);

        // Group restored orders by market for summary
        const marketSummary = new Map<string, number>();
        for (const order of restoredOrders) {
            marketSummary.set(order.marketId, (marketSummary.get(order.marketId) ?? 0) + 1);
        }

        for (const [marketId, count] of marketSummary) {
            console.log(`[Orderbook Rehydration]   Market ${marketId}: ${count} orders`);
        }

        return {
            restoredCount: restoredOrders.length,
            excludedCount: excludedOrders.length,
            restoredOrders,
            excludedOrders,
            marketSummary: Object.fromEntries(marketSummary),
        };
    }

    /**
     * Rehydrate orderbook for a specific market only
     */
    rehydrateMarket(engine: MatchingEngine, marketId: string): RehydrationResult {
        const openOrders = this.loadOpenOrders(marketId);
        const ordersWithPendingSettlements = this.getOrdersWithPendingSettlements();

        const excludedOrders: Order[] = [];
        const restoredOrders: Order[] = [];

        const safeOrders = openOrders.filter((order) => {
            if (ordersWithPendingSettlements.has(order.orderId)) {
                excludedOrders.push(order);
                return false;
            }
            return true;
        });

        safeOrders.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

        for (const order of safeOrders) {
            engine.addOrderToBook(order);
            restoredOrders.push(order);
        }

        return {
            restoredCount: restoredOrders.length,
            excludedCount: excludedOrders.length,
            restoredOrders,
            excludedOrders,
            marketSummary: { [marketId]: restoredOrders.length },
        };
    }

    /**
     * Mark an order as cancelled in the database
     */
    cancelOrder(orderId: string): void {
        this.orderRepo.updateStatus(orderId, "cancelled");
    }

    /**
     * Delete an order from the database
     * Use sparingly - typically prefer status updates for audit trail
     */
    deleteOrder(orderId: string): void {
        this.orderRepo.delete(orderId);
    }
}

/**
 * Result of orderbook rehydration
 */
export interface RehydrationResult {
    /** Number of orders successfully restored */
    restoredCount: number;
    /** Number of orders excluded (pending settlements) */
    excludedCount: number;
    /** List of restored orders */
    restoredOrders: Order[];
    /** List of excluded orders (for manual review) */
    excludedOrders: Order[];
    /** Count of orders per market */
    marketSummary: Record<string, number>;
}
