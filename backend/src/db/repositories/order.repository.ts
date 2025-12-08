/**
 * Order repository for database operations
 */

import Decimal from "decimal.js";
import { BaseRepository } from "./base.repository";
import type { Order, OrderStatus } from "../../types";

interface OrderRow {
    order_id: string;
    market_id: string;
    user_id: string;
    side: string;
    action: string;
    order_type: string;
    price: number | null;
    quantity: number;
    filled_quantity: number;
    status: string;
    locked_amount: number;
    canton_lock_tx_id: string | null;
    idempotency_key: string | null;
    created_at: string;
    updated_at: string;
}

export class OrderRepository extends BaseRepository {
    /**
     * Get order by ID
     */
    getById(orderId: string): Order | null {
        const row = this.db.query("SELECT * FROM orders WHERE order_id = ?").get(orderId) as OrderRow | null;

        return row ? this.rowToOrder(row) : null;
    }

    /**
     * Get orders by user
     */
    getByUser(userId: string): Order[] {
        const rows = this.db
            .query("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC")
            .all(userId) as OrderRow[];

        return rows.map((row) => this.rowToOrder(row));
    }

    /**
     * Get orders by market
     */
    getByMarket(marketId: string): Order[] {
        const rows = this.db
            .query("SELECT * FROM orders WHERE market_id = ? ORDER BY created_at DESC")
            .all(marketId) as OrderRow[];

        return rows.map((row) => this.rowToOrder(row));
    }

    /**
     * Get open orders (for orderbook)
     */
    getOpenOrders(marketId?: string): Order[] {
        let query = "SELECT * FROM orders WHERE status IN ('open', 'partial')";
        const params: string[] = [];

        if (marketId) {
            query += " AND market_id = ?";
            params.push(marketId);
        }

        query += " ORDER BY created_at ASC";

        const rows = this.db.query(query).all(...params) as OrderRow[];
        return rows.map((row) => this.rowToOrder(row));
    }

    /**
     * Get open orders by user and market
     */
    getOpenOrdersByUser(userId: string, marketId?: string): Order[] {
        let query = "SELECT * FROM orders WHERE user_id = ? AND status IN ('open', 'partial')";
        const params: string[] = [userId];

        if (marketId) {
            query += " AND market_id = ?";
            params.push(marketId);
        }

        query += " ORDER BY created_at DESC";

        const rows = this.db.query(query).all(...params) as OrderRow[];
        return rows.map((row) => this.rowToOrder(row));
    }

    /**
     * Check for existing order by idempotency key
     */
    getByIdempotencyKey(userId: string, key: string): Order | null {
        const row = this.db
            .query("SELECT * FROM orders WHERE user_id = ? AND idempotency_key = ?")
            .get(userId, key) as OrderRow | null;

        return row ? this.rowToOrder(row) : null;
    }

    /**
     * Create a new order
     */
    create(order: Order): void {
        this.db.run(
            `
      INSERT INTO orders
      (order_id, market_id, user_id, side, action, order_type, price, quantity,
       filled_quantity, status, locked_amount, canton_lock_tx_id, idempotency_key,
       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
            [
                order.orderId,
                order.marketId,
                order.userId,
                order.side,
                order.action,
                order.orderType,
                order.price ? this.toSqlNumber(order.price) : null,
                this.toSqlNumber(order.quantity),
                this.toSqlNumber(order.filledQuantity),
                order.status,
                this.toSqlNumber(order.lockedAmount),
                order.cantonLockTxId ?? null,
                order.idempotencyKey ?? null,
                this.toSqlDate(order.createdAt),
                this.toSqlDate(order.updatedAt),
            ],
        );
    }

    /**
     * Update order status
     */
    updateStatus(orderId: string, status: OrderStatus): void {
        this.db.run("UPDATE orders SET status = ?, updated_at = ? WHERE order_id = ?", [status, this.now(), orderId]);
    }

    /**
     * Update filled quantity
     */
    updateFilled(orderId: string, filledQuantity: Decimal, status: OrderStatus): void {
        this.db.run("UPDATE orders SET filled_quantity = ?, status = ?, updated_at = ? WHERE order_id = ?", [
            this.toSqlNumber(filledQuantity),
            status,
            this.now(),
            orderId,
        ]);
    }

    /**
     * Update Canton lock transaction ID
     */
    updateCantonLockTx(orderId: string, txId: string): void {
        this.db.run("UPDATE orders SET canton_lock_tx_id = ?, updated_at = ? WHERE order_id = ?", [
            txId,
            this.now(),
            orderId,
        ]);
    }

    /**
     * Update locked amount
     */
    updateLockedAmount(orderId: string, lockedAmount: Decimal): void {
        this.db.run("UPDATE orders SET locked_amount = ?, updated_at = ? WHERE order_id = ?", [
            this.toSqlNumber(lockedAmount),
            this.now(),
            orderId,
        ]);
    }

    /**
     * Get orders with pending/settling trades
     */
    getOrdersWithPendingSettlements(): string[] {
        const rows = this.db
            .query(
                `
      SELECT DISTINCT o.order_id
      FROM orders o
      INNER JOIN trades t ON (o.order_id = t.buyer_order_id OR o.order_id = t.seller_order_id)
      WHERE t.settlement_status IN ('pending', 'settling')
    `,
            )
            .all() as { order_id: string }[];

        return rows.map((r) => r.order_id);
    }

    /**
     * Delete an order
     */
    delete(orderId: string): void {
        this.db.run("DELETE FROM orders WHERE order_id = ?", [orderId]);
    }

    private rowToOrder(row: OrderRow): Order {
        return {
            orderId: row.order_id,
            marketId: row.market_id,
            userId: row.user_id,
            side: row.side as Order["side"],
            action: row.action as Order["action"],
            orderType: row.order_type as Order["orderType"],
            price: this.fromSqlNumber(row.price),
            quantity: this.fromSqlNumber(row.quantity),
            filledQuantity: this.fromSqlNumber(row.filled_quantity),
            status: row.status as OrderStatus,
            lockedAmount: this.fromSqlNumber(row.locked_amount),
            cantonLockTxId: row.canton_lock_tx_id ?? undefined,
            idempotencyKey: row.idempotency_key ?? undefined,
            createdAt: this.fromSqlDate(row.created_at),
            updatedAt: this.fromSqlDate(row.updated_at),
        };
    }
}
