/**
 * In-memory orderbook for a single market
 * Manages bid/ask orders for both YES and NO sides
 */

import type { Order, OrderBook, OrderBookLevel, OrderSide, OrderAction } from "../types";

/**
 * In-memory orderbook data structure for a single market
 *
 * Structure:
 * - YES side: yesBids (buy YES orders), yesAsks (sell YES orders)
 * - NO side: noBids (buy NO orders), noAsks (sell NO orders)
 *
 * Sorting:
 * - Bids: descending by price (highest first), then FIFO by createdAt
 * - Asks: ascending by price (lowest first), then FIFO by createdAt
 */
export class InMemoryOrderBook {
    /** Market ID this orderbook belongs to */
    readonly marketId: string;

    // Order maps: orderId -> Order
    private yesBids: Map<string, Order> = new Map();
    private yesAsks: Map<string, Order> = new Map();
    private noBids: Map<string, Order> = new Map();
    private noAsks: Map<string, Order> = new Map();

    constructor(marketId: string) {
        this.marketId = marketId;
    }

    // ============================================
    // Order Management
    // ============================================

    /**
     * Add an order to the correct side of the book
     */
    addOrder(order: Order): void {
        if (order.marketId !== this.marketId) {
            throw new Error(`Order market ${order.marketId} doesn't match book ${this.marketId}`);
        }

        const map = this.getMapForOrder(order.side, order.action);
        map.set(order.orderId, order);
    }

    /**
     * Remove an order from the book
     * Returns true if order was found and removed
     */
    removeOrder(orderId: string): boolean {
        // Try all four maps
        for (const map of [this.yesBids, this.yesAsks, this.noBids, this.noAsks]) {
            if (map.delete(orderId)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get an order by ID
     */
    getOrder(orderId: string): Order | null {
        for (const map of [this.yesBids, this.yesAsks, this.noBids, this.noAsks]) {
            const order = map.get(orderId);
            if (order) return order;
        }
        return null;
    }

    /**
     * Check if an order exists in the book
     */
    hasOrder(orderId: string): boolean {
        return this.getOrder(orderId) !== null;
    }

    /**
     * Update an order in the book (for partial fills)
     */
    updateOrder(order: Order): boolean {
        // Find and update in the correct map
        for (const map of [this.yesBids, this.yesAsks, this.noBids, this.noAsks]) {
            if (map.has(order.orderId)) {
                map.set(order.orderId, order);
                return true;
            }
        }
        return false;
    }

    // ============================================
    // Sorted Order Accessors (for matching)
    // ============================================

    /**
     * Get YES buy orders sorted by price (highest first), then FIFO
     */
    getYesBids(): Order[] {
        return this.sortBids(Array.from(this.yesBids.values()));
    }

    /**
     * Get YES sell orders sorted by price (lowest first), then FIFO
     */
    getYesAsks(): Order[] {
        return this.sortAsks(Array.from(this.yesAsks.values()));
    }

    /**
     * Get NO buy orders sorted by price (highest first), then FIFO
     */
    getNoBids(): Order[] {
        return this.sortBids(Array.from(this.noBids.values()));
    }

    /**
     * Get NO sell orders sorted by price (lowest first), then FIFO
     */
    getNoAsks(): Order[] {
        return this.sortAsks(Array.from(this.noAsks.values()));
    }

    /**
     * Get all orders in the book (for persistence)
     */
    getAllOrders(): Order[] {
        return [...this.yesBids.values(), ...this.yesAsks.values(), ...this.noBids.values(), ...this.noAsks.values()];
    }

    /**
     * Get count of all orders
     */
    getOrderCount(): number {
        return this.yesBids.size + this.yesAsks.size + this.noBids.size + this.noAsks.size;
    }

    // ============================================
    // Public Snapshot for API
    // ============================================

    /**
     * Generate an OrderBook snapshot for API responses
     */
    toOrderBook(): OrderBook {
        return {
            marketId: this.marketId,
            yes: {
                bids: this.aggregateLevels(this.getYesBids()),
                asks: this.aggregateLevels(this.getYesAsks()),
            },
            no: {
                bids: this.aggregateLevels(this.getNoBids()),
                asks: this.aggregateLevels(this.getNoAsks()),
            },
            lastUpdated: new Date(),
        };
    }

    // ============================================
    // Private Helpers
    // ============================================

    /**
     * Get the correct map for an order's side and action
     */
    private getMapForOrder(side: OrderSide, action: OrderAction): Map<string, Order> {
        if (side === "yes") {
            return action === "buy" ? this.yesBids : this.yesAsks;
        } else {
            return action === "buy" ? this.noBids : this.noAsks;
        }
    }

    /**
     * Sort bids: highest price first, then FIFO by createdAt
     */
    private sortBids(orders: Order[]): Order[] {
        return orders.sort((a, b) => {
            // Filter out fully filled orders
            const aRemaining = a.quantity.minus(a.filledQuantity);
            const bRemaining = b.quantity.minus(b.filledQuantity);
            if (aRemaining.lte(0) && bRemaining.gt(0)) return 1;
            if (bRemaining.lte(0) && aRemaining.gt(0)) return -1;

            // Price comparison: highest first
            const priceDiff = b.price.minus(a.price);
            if (!priceDiff.isZero()) {
                return priceDiff.toNumber();
            }

            // Time priority: earlier first (FIFO)
            return a.createdAt.getTime() - b.createdAt.getTime();
        });
    }

    /**
     * Sort asks: lowest price first, then FIFO by createdAt
     */
    private sortAsks(orders: Order[]): Order[] {
        return orders.sort((a, b) => {
            // Filter out fully filled orders
            const aRemaining = a.quantity.minus(a.filledQuantity);
            const bRemaining = b.quantity.minus(b.filledQuantity);
            if (aRemaining.lte(0) && bRemaining.gt(0)) return 1;
            if (bRemaining.lte(0) && aRemaining.gt(0)) return -1;

            // Price comparison: lowest first
            const priceDiff = a.price.minus(b.price);
            if (!priceDiff.isZero()) {
                return priceDiff.toNumber();
            }

            // Time priority: earlier first (FIFO)
            return a.createdAt.getTime() - b.createdAt.getTime();
        });
    }

    /**
     * Aggregate orders at the same price level
     */
    private aggregateLevels(orders: Order[]): OrderBookLevel[] {
        const levels = new Map<string, OrderBookLevel>();

        for (const order of orders) {
            const remainingQty = order.quantity.minus(order.filledQuantity);
            if (remainingQty.lte(0)) continue;

            const priceKey = order.price.toString();
            const existing = levels.get(priceKey);

            if (existing) {
                existing.quantity = existing.quantity.plus(remainingQty);
                existing.orderCount++;
            } else {
                levels.set(priceKey, {
                    price: order.price,
                    quantity: remainingQty,
                    orderCount: 1,
                });
            }
        }

        return Array.from(levels.values());
    }

    // ============================================
    // Clearing
    // ============================================

    /**
     * Clear all orders from the book
     */
    clear(): void {
        this.yesBids.clear();
        this.yesAsks.clear();
        this.noBids.clear();
        this.noAsks.clear();
    }
}
