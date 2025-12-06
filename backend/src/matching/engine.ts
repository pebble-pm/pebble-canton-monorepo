/**
 * Matching Engine for binary prediction markets
 *
 * Features:
 * - Price-time priority matching
 * - Binary market cross-matching (BUY YES ↔ BUY NO creates new shares)
 * - Self-match prevention
 * - Partial fill handling
 */

import Decimal from "decimal.js";
import { InMemoryOrderBook } from "./orderbook";
import type { Order, OrderBook, OrderStatus, Trade, OrderSide } from "../types";

// ============================================
// Types
// ============================================

/**
 * Extended order with cross-match metadata for matching algorithm
 */
interface MatchableOrder extends Order {
    /** Effective price after inversion (for cross-matches) */
    _effectivePrice?: Decimal;
    /** Whether this order is a cross-match candidate */
    _isCrossMatch?: boolean;
}

/**
 * Result from processing an order through the matching engine
 */
export interface MatchResult {
    /** Trades executed from matching */
    trades: Trade[];
    /** Remaining order to add to book (null if fully filled or rejected) */
    remainingOrder: Order | null;
    /** Final status of the order */
    orderStatus: OrderStatus;
    /** Total quantity filled */
    filledQuantity: Decimal;
}

// ============================================
// Matching Engine
// ============================================

export class MatchingEngine {
    /** Map of marketId -> orderbook */
    private orderBooks: Map<string, InMemoryOrderBook> = new Map();

    /** Index of orderId -> Order for fast lookups */
    private orderIndex: Map<string, Order> = new Map();

    /**
     * Process an incoming order through the matching engine
     *
     * @param order The order to process
     * @returns MatchResult with trades, remaining order, and final status
     */
    processOrder(order: Order): MatchResult {
        const book = this.getOrCreateOrderBook(order.marketId);
        const trades: Trade[] = [];
        let remainingQuantity = order.quantity;

        // Get potential matching orders
        const matchingOrders = this.getMatchingOrders(book, order);

        for (const matchingOrder of matchingOrders) {
            if (remainingQuantity.lte(0)) break;

            // SELF-MATCH PREVENTION: Skip orders from the same user
            if (matchingOrder.userId === order.userId) {
                continue;
            }

            // For market orders, match at any price
            // For limit orders, check price compatibility
            if (order.orderType === "limit" && !this.pricesMatch(order, matchingOrder)) {
                break; // No more matches at acceptable prices (orders are sorted)
            }

            // Calculate fill quantity
            const makerRemaining = matchingOrder.quantity.minus(matchingOrder.filledQuantity);
            const fillQty = Decimal.min(remainingQuantity, makerRemaining);

            // Price improvement goes to taker (incoming order) - use maker's price
            const effectivePrice = matchingOrder._effectivePrice ?? matchingOrder.price;

            // Create trade record
            const trade = this.createTrade(order, matchingOrder, fillQty, effectivePrice);
            trades.push(trade);

            // Update matching (maker) order
            matchingOrder.filledQuantity = matchingOrder.filledQuantity.plus(fillQty);
            matchingOrder.updatedAt = new Date();

            if (matchingOrder.filledQuantity.gte(matchingOrder.quantity)) {
                matchingOrder.status = "filled";
                book.removeOrder(matchingOrder.orderId);
                this.orderIndex.delete(matchingOrder.orderId);
            } else {
                matchingOrder.status = "partial";
                book.updateOrder(matchingOrder);
                this.orderIndex.set(matchingOrder.orderId, matchingOrder);
            }

            remainingQuantity = remainingQuantity.minus(fillQty);
        }

        // Determine final order status
        const filledQuantity = order.quantity.minus(remainingQuantity);
        let orderStatus: OrderStatus;
        let remainingOrder: Order | null = null;

        if (remainingQuantity.isZero()) {
            // Fully filled
            orderStatus = "filled";
        } else if (filledQuantity.gt(0)) {
            // Partially filled
            if (order.orderType === "limit") {
                // Add remaining to book
                orderStatus = "partial";
                remainingOrder = {
                    ...order,
                    filledQuantity,
                    status: "open",
                    updatedAt: new Date(),
                };
                book.addOrder(remainingOrder);
                this.orderIndex.set(remainingOrder.orderId, remainingOrder);
            } else {
                // Market order - partial fill, no remaining
                orderStatus = "partial";
            }
        } else {
            // No fills at all
            if (order.orderType === "market") {
                // Market order with no liquidity - rejected
                orderStatus = "rejected";
            } else {
                // Limit order with no matches - add to book
                orderStatus = "open";
                remainingOrder = {
                    ...order,
                    filledQuantity: new Decimal(0),
                    status: "open",
                    updatedAt: new Date(),
                };
                book.addOrder(remainingOrder);
                this.orderIndex.set(remainingOrder.orderId, remainingOrder);
            }
        }

        return {
            trades,
            remainingOrder,
            orderStatus,
            filledQuantity,
        };
    }

    /**
     * Add an order directly to the book without matching
     * Used for orderbook rehydration after crash recovery
     */
    addOrderToBook(order: Order): void {
        const book = this.getOrCreateOrderBook(order.marketId);
        book.addOrder(order);
        this.orderIndex.set(order.orderId, order);
    }

    /**
     * Cancel an order and remove it from the book
     */
    cancelOrder(orderId: string, marketId: string): Order | null {
        const order = this.orderIndex.get(orderId);
        if (!order || order.status === "filled" || order.status === "cancelled") {
            return null;
        }

        const book = this.orderBooks.get(marketId);
        if (book) {
            book.removeOrder(orderId);
        }

        order.status = "cancelled";
        order.updatedAt = new Date();
        this.orderIndex.set(orderId, order);

        return order;
    }

    /**
     * Get an order by ID
     */
    getOrder(orderId: string): Order | null {
        return this.orderIndex.get(orderId) ?? null;
    }

    /**
     * Get orderbook snapshot for a market
     */
    getOrderBook(marketId: string): OrderBook {
        const book = this.orderBooks.get(marketId);
        if (!book) {
            return {
                marketId,
                yes: { bids: [], asks: [] },
                no: { bids: [], asks: [] },
                lastUpdated: new Date(),
            };
        }
        return book.toOrderBook();
    }

    /**
     * Get all markets with active orderbooks
     */
    getActiveMarkets(): string[] {
        return Array.from(this.orderBooks.keys());
    }

    /**
     * Clear all data (for testing)
     */
    clear(): void {
        this.orderBooks.clear();
        this.orderIndex.clear();
    }

    // ============================================
    // Private Methods
    // ============================================

    /**
     * Get or create an orderbook for a market
     */
    private getOrCreateOrderBook(marketId: string): InMemoryOrderBook {
        let book = this.orderBooks.get(marketId);
        if (!book) {
            book = new InMemoryOrderBook(marketId);
            this.orderBooks.set(marketId, book);
        }
        return book;
    }

    /**
     * Get matching orders for an incoming order
     *
     * Binary market cross-matching logic:
     * - BUY YES matches: SELL YES asks + BUY NO bids (at 1-price)
     * - BUY NO matches: SELL NO asks + BUY YES bids (at 1-price)
     * - SELL YES matches: BUY YES bids + SELL NO asks (at 1-price)
     * - SELL NO matches: BUY NO bids + SELL YES asks (at 1-price)
     */
    private getMatchingOrders(book: InMemoryOrderBook, order: Order): MatchableOrder[] {
        const orders: MatchableOrder[] = [];

        if (order.action === "buy") {
            if (order.side === "yes") {
                // Buying YES: match with SELL YES orders first
                orders.push(...book.getYesAsks());
                // Also match with BUY NO orders (inverted price) - creates new shares
                const noBids = book.getNoBids().map((o) => ({
                    ...o,
                    _effectivePrice: new Decimal(1).minus(o.price),
                    _isCrossMatch: true,
                }));
                orders.push(...noBids);
            } else {
                // Buying NO: match with SELL NO orders first
                orders.push(...book.getNoAsks());
                // Also match with BUY YES orders (inverted price) - creates new shares
                const yesBids = book.getYesBids().map((o) => ({
                    ...o,
                    _effectivePrice: new Decimal(1).minus(o.price),
                    _isCrossMatch: true,
                }));
                orders.push(...yesBids);
            }
        } else {
            // Selling
            if (order.side === "yes") {
                // Selling YES: match with BUY YES orders first
                orders.push(...book.getYesBids());
                // Also match with SELL NO orders (inverted price)
                const noAsks = book.getNoAsks().map((o) => ({
                    ...o,
                    _effectivePrice: new Decimal(1).minus(o.price),
                    _isCrossMatch: true,
                }));
                orders.push(...noAsks);
            } else {
                // Selling NO: match with BUY NO orders first
                orders.push(...book.getNoBids());
                // Also match with SELL YES orders (inverted price)
                const yesAsks = book.getYesAsks().map((o) => ({
                    ...o,
                    _effectivePrice: new Decimal(1).minus(o.price),
                    _isCrossMatch: true,
                }));
                orders.push(...yesAsks);
            }
        }

        // Sort by effective price (best first) then time
        return orders.sort((a, b) => {
            const priceA = a._effectivePrice ?? a.price;
            const priceB = b._effectivePrice ?? b.price;

            if (order.action === "buy") {
                // For buy orders, lowest ask price first
                const priceDiff = priceA.minus(priceB);
                if (!priceDiff.isZero()) return priceDiff.toNumber();
            } else {
                // For sell orders, highest bid price first
                const priceDiff = priceB.minus(priceA);
                if (!priceDiff.isZero()) return priceDiff.toNumber();
            }

            // Time priority (FIFO)
            return a.createdAt.getTime() - b.createdAt.getTime();
        });
    }

    /**
     * Check if incoming order's price matches resting order's price
     */
    private pricesMatch(incomingOrder: Order, restingOrder: MatchableOrder): boolean {
        const restingPrice = restingOrder._effectivePrice ?? restingOrder.price;

        if (incomingOrder.action === "buy") {
            // Buy order matches if resting price <= incoming price
            return restingPrice.lte(incomingOrder.price);
        } else {
            // Sell order matches if resting price >= incoming price
            return restingPrice.gte(incomingOrder.price);
        }
    }

    /**
     * Create a trade record from a match
     *
     * Trade types:
     * - share_creation: Cross-match (BUY YES ↔ BUY NO) - creates new shares
     * - share_trade: Standard (BUY ↔ SELL same side) - transfers existing shares
     */
    private createTrade(takerOrder: Order, makerOrder: MatchableOrder, quantity: Decimal, price: Decimal): Trade {
        const isCrossMatch = makerOrder._isCrossMatch === true;
        const tradeType: Trade["tradeType"] = isCrossMatch ? "share_creation" : "share_trade";

        // Determine buyer/seller IDs based on trade type
        let buyerId: string;
        let sellerId: string;
        let buyerOrderId: string;
        let sellerOrderId: string;
        let tradeSide: OrderSide;
        let tradePrice: Decimal;

        if (tradeType === "share_creation") {
            // Cross-match: both parties are buyers creating new shares
            // Normalize: YES buyer is "buyer", NO buyer is "seller" (counterparty)
            if (takerOrder.side === "yes") {
                buyerId = takerOrder.userId;
                sellerId = makerOrder.userId;
                buyerOrderId = takerOrder.orderId;
                sellerOrderId = makerOrder.orderId;
                tradeSide = "yes";
                tradePrice = price; // Already effective price
            } else {
                // Taker is buying NO, maker is buying YES
                buyerId = makerOrder.userId;
                sellerId = takerOrder.userId;
                buyerOrderId = makerOrder.orderId;
                sellerOrderId = takerOrder.orderId;
                tradeSide = "yes";
                // Convert NO price to YES price (1 - NO price = YES price)
                tradePrice = new Decimal(1).minus(takerOrder.price);
            }
        } else {
            // Standard share trade
            const isTakerBuying = takerOrder.action === "buy";
            buyerId = isTakerBuying ? takerOrder.userId : makerOrder.userId;
            sellerId = isTakerBuying ? makerOrder.userId : takerOrder.userId;
            buyerOrderId = isTakerBuying ? takerOrder.orderId : makerOrder.orderId;
            sellerOrderId = isTakerBuying ? makerOrder.orderId : takerOrder.orderId;
            tradeSide = takerOrder.side;
            tradePrice = price;
        }

        return {
            tradeId: crypto.randomUUID(),
            marketId: takerOrder.marketId,
            buyerId,
            sellerId,
            side: tradeSide,
            price: tradePrice,
            quantity,
            buyerOrderId,
            sellerOrderId,
            tradeType,
            settlementId: "", // Assigned by settlement service
            settlementStatus: "pending",
            createdAt: new Date(),
        };
    }
}
