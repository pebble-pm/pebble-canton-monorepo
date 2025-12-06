/**
 * Trade repository for database operations
 */

import Decimal from "decimal.js";
import { BaseRepository } from "./base.repository";
import type { Trade, SettlementStatus } from "../../types";

interface TradeRow {
    trade_id: string;
    market_id: string;
    buyer_id: string;
    seller_id: string;
    side: string;
    price: number;
    quantity: number;
    buyer_order_id: string;
    seller_order_id: string;
    trade_type: string;
    settlement_id: string | null;
    settlement_status: string;
    created_at: string;
    settled_at: string | null;
}

export class TradeRepository extends BaseRepository {
    /**
     * Get trade by ID
     */
    getById(tradeId: string): Trade | null {
        const row = this.db.query("SELECT * FROM trades WHERE trade_id = ?").get(tradeId) as TradeRow | null;

        return row ? this.rowToTrade(row) : null;
    }

    /**
     * Get trades by market
     */
    getByMarket(marketId: string, limit: number = 100): Trade[] {
        const rows = this.db
            .query("SELECT * FROM trades WHERE market_id = ? ORDER BY created_at DESC LIMIT ?")
            .all(marketId, limit) as TradeRow[];

        return rows.map((row) => this.rowToTrade(row));
    }

    /**
     * Get trades by user (as buyer or seller)
     */
    getByUser(userId: string): Trade[] {
        const rows = this.db
            .query(
                `SELECT * FROM trades
         WHERE buyer_id = ? OR seller_id = ?
         ORDER BY created_at DESC`,
            )
            .all(userId, userId) as TradeRow[];

        return rows.map((row) => this.rowToTrade(row));
    }

    /**
     * Get trades by settlement status
     */
    getByStatus(statuses: SettlementStatus[]): Trade[] {
        const placeholders = statuses.map(() => "?").join(", ");
        const rows = this.db
            .query(
                `SELECT * FROM trades
         WHERE settlement_status IN (${placeholders})
         ORDER BY created_at ASC`,
            )
            .all(...statuses) as TradeRow[];

        return rows.map((row) => this.rowToTrade(row));
    }

    /**
     * Get pending trades for settlement
     */
    getPendingTrades(limit: number = 100): Trade[] {
        const rows = this.db
            .query(
                `SELECT * FROM trades
         WHERE settlement_status = 'pending'
         ORDER BY created_at ASC
         LIMIT ?`,
            )
            .all(limit) as TradeRow[];

        return rows.map((row) => this.rowToTrade(row));
    }

    /**
     * Get recent trades for public display
     */
    getRecentTrades(marketId: string, limit: number = 50): Trade[] {
        const rows = this.db
            .query(
                `SELECT * FROM trades
         WHERE market_id = ? AND settlement_status = 'settled'
         ORDER BY settled_at DESC
         LIMIT ?`,
            )
            .all(marketId, limit) as TradeRow[];

        return rows.map((row) => this.rowToTrade(row));
    }

    /**
     * Create a new trade
     */
    create(trade: Trade): void {
        this.db.run(
            `
      INSERT INTO trades
      (trade_id, market_id, buyer_id, seller_id, side, price, quantity,
       buyer_order_id, seller_order_id, trade_type, settlement_id,
       settlement_status, created_at, settled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
            [
                trade.tradeId,
                trade.marketId,
                trade.buyerId,
                trade.sellerId,
                trade.side,
                this.toSqlNumber(trade.price),
                this.toSqlNumber(trade.quantity),
                trade.buyerOrderId,
                trade.sellerOrderId,
                trade.tradeType,
                trade.settlementId || null,
                trade.settlementStatus,
                this.toSqlDate(trade.createdAt),
                trade.settledAt ? this.toSqlDate(trade.settledAt) : null,
            ],
        );
    }

    /**
     * Update settlement status
     */
    updateSettlementStatus(tradeId: string, status: SettlementStatus, settlementId?: string): void {
        if (status === "settled") {
            this.db.run(
                `UPDATE trades
         SET settlement_status = ?, settlement_id = ?, settled_at = ?
         WHERE trade_id = ?`,
                [status, settlementId ?? null, this.now(), tradeId],
            );
        } else {
            this.db.run(
                `UPDATE trades
         SET settlement_status = ?, settlement_id = ?
         WHERE trade_id = ?`,
                [status, settlementId ?? null, tradeId],
            );
        }
    }

    /**
     * Update multiple trades' settlement status
     */
    updateBatchSettlementStatus(tradeIds: string[], status: SettlementStatus, settlementId?: string): void {
        const placeholders = tradeIds.map(() => "?").join(", ");

        if (status === "settled") {
            this.db.run(
                `UPDATE trades
         SET settlement_status = ?, settlement_id = ?, settled_at = ?
         WHERE trade_id IN (${placeholders})`,
                [status, settlementId ?? null, this.now(), ...tradeIds],
            );
        } else {
            this.db.run(
                `UPDATE trades
         SET settlement_status = ?, settlement_id = ?
         WHERE trade_id IN (${placeholders})`,
                [status, settlementId ?? null, ...tradeIds],
            );
        }
    }

    /**
     * Get trade volume for market in last 24 hours
     */
    get24hVolume(marketId: string): Decimal {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const row = this.db
            .query(
                `SELECT SUM(price * quantity) as volume
         FROM trades
         WHERE market_id = ? AND created_at > ? AND settlement_status = 'settled'`,
            )
            .get(marketId, cutoff) as { volume: number | null } | null;

        return this.fromSqlNumber(row?.volume ?? 0);
    }

    /**
     * Delete a trade
     */
    delete(tradeId: string): void {
        this.db.run("DELETE FROM trades WHERE trade_id = ?", [tradeId]);
    }

    private rowToTrade(row: TradeRow): Trade {
        return {
            tradeId: row.trade_id,
            marketId: row.market_id,
            buyerId: row.buyer_id,
            sellerId: row.seller_id,
            side: row.side as Trade["side"],
            price: this.fromSqlNumber(row.price),
            quantity: this.fromSqlNumber(row.quantity),
            buyerOrderId: row.buyer_order_id,
            sellerOrderId: row.seller_order_id,
            tradeType: row.trade_type as Trade["tradeType"],
            settlementId: row.settlement_id ?? "",
            settlementStatus: row.settlement_status as SettlementStatus,
            createdAt: this.fromSqlDate(row.created_at),
            settledAt: row.settled_at ? this.fromSqlDate(row.settled_at) : undefined,
        };
    }
}
