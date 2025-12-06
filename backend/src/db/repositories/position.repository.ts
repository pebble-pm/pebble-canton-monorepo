/**
 * Position repository for database operations
 */

import Decimal from "decimal.js";
import { BaseRepository } from "./base.repository";
import type { Position } from "../../types";

interface PositionRow {
    position_id: string;
    user_id: string;
    market_id: string;
    side: string;
    quantity: number;
    locked_quantity: number;
    avg_cost_basis: number;
    is_archived: number;
    last_updated: string;
}

export class PositionRepository extends BaseRepository {
    /**
     * Get position by ID
     */
    getById(positionId: string): Position | null {
        const row = this.db.query("SELECT * FROM positions WHERE position_id = ?").get(positionId) as PositionRow | null;

        return row ? this.rowToPosition(row) : null;
    }

    /**
     * Get positions by user
     */
    getByUser(userId: string, includeArchived: boolean = false): Position[] {
        const query = includeArchived
            ? "SELECT * FROM positions WHERE user_id = ? ORDER BY market_id, side"
            : "SELECT * FROM positions WHERE user_id = ? AND is_archived = 0 ORDER BY market_id, side";

        const rows = this.db.query(query).all(userId) as PositionRow[];
        return rows.map((row) => this.rowToPosition(row));
    }

    /**
     * Get positions by market
     */
    getByMarket(marketId: string, includeArchived: boolean = false): Position[] {
        const query = includeArchived
            ? "SELECT * FROM positions WHERE market_id = ? ORDER BY user_id, side"
            : "SELECT * FROM positions WHERE market_id = ? AND is_archived = 0 ORDER BY user_id, side";

        const rows = this.db.query(query).all(marketId) as PositionRow[];
        return rows.map((row) => this.rowToPosition(row));
    }

    /**
     * Get specific position by user, market, and side
     */
    getByUserMarketSide(userId: string, marketId: string, side: "yes" | "no"): Position | null {
        const row = this.db
            .query(
                `SELECT * FROM positions
         WHERE user_id = ? AND market_id = ? AND side = ? AND is_archived = 0`,
            )
            .get(userId, marketId, side) as PositionRow | null;

        return row ? this.rowToPosition(row) : null;
    }

    /**
     * Get all active positions for a user in a market (YES and NO)
     */
    getUserMarketPositions(userId: string, marketId: string): { yes: Position | null; no: Position | null } {
        return {
            yes: this.getByUserMarketSide(userId, marketId, "yes"),
            no: this.getByUserMarketSide(userId, marketId, "no"),
        };
    }

    /**
     * Create a new position
     */
    create(position: Position): void {
        this.db.run(
            `
      INSERT INTO positions
      (position_id, user_id, market_id, side, quantity, locked_quantity,
       avg_cost_basis, is_archived, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
            [
                position.positionId,
                position.userId,
                position.marketId,
                position.side,
                this.toSqlNumber(position.quantity),
                this.toSqlNumber(position.lockedQuantity),
                this.toSqlNumber(position.avgCostBasis),
                this.toSqlBool(position.isArchived),
                this.toSqlDate(position.lastUpdated),
            ],
        );
    }

    /**
     * Update position quantity and cost basis
     */
    updateQuantity(positionId: string, quantity: Decimal, avgCostBasis: Decimal): void {
        this.db.run(
            `UPDATE positions
       SET quantity = ?, avg_cost_basis = ?, last_updated = ?
       WHERE position_id = ?`,
            [this.toSqlNumber(quantity), this.toSqlNumber(avgCostBasis), this.now(), positionId],
        );
    }

    /**
     * Update locked quantity
     */
    updateLockedQuantity(positionId: string, lockedQuantity: Decimal): void {
        this.db.run(
            `UPDATE positions
       SET locked_quantity = ?, last_updated = ?
       WHERE position_id = ?`,
            [this.toSqlNumber(lockedQuantity), this.now(), positionId],
        );
    }

    /**
     * Lock position shares
     */
    lockShares(positionId: string, amount: Decimal): boolean {
        const position = this.getById(positionId);
        if (!position) return false;

        const available = position.quantity.minus(position.lockedQuantity);
        if (available.lt(amount)) return false;

        const newLocked = position.lockedQuantity.plus(amount);
        this.updateLockedQuantity(positionId, newLocked);
        return true;
    }

    /**
     * Unlock position shares
     */
    unlockShares(positionId: string, amount: Decimal): boolean {
        const position = this.getById(positionId);
        if (!position || position.lockedQuantity.lt(amount)) return false;

        const newLocked = position.lockedQuantity.minus(amount);
        this.updateLockedQuantity(positionId, newLocked);
        return true;
    }

    /**
     * Add to position (increase quantity with weighted average cost)
     */
    addToPosition(positionId: string, addQuantity: Decimal, price: Decimal): void {
        const position = this.getById(positionId);
        if (!position) return;

        const newQuantity = position.quantity.plus(addQuantity);
        const totalCost = position.quantity.mul(position.avgCostBasis).plus(addQuantity.mul(price));
        const newAvgCost = totalCost.div(newQuantity);

        this.updateQuantity(positionId, newQuantity, newAvgCost);
    }

    /**
     * Reduce position (decrease quantity from locked shares)
     */
    reducePosition(positionId: string, reduceQuantity: Decimal): boolean {
        const position = this.getById(positionId);
        if (!position) return false;
        if (position.lockedQuantity.lt(reduceQuantity)) return false;

        const newQuantity = position.quantity.minus(reduceQuantity);
        const newLocked = position.lockedQuantity.minus(reduceQuantity);

        if (newQuantity.lte(0)) {
            // Archive the position
            this.db.run(
                `UPDATE positions
         SET quantity = 0, locked_quantity = 0, is_archived = 1, last_updated = ?
         WHERE position_id = ?`,
                [this.now(), positionId],
            );
        } else {
            this.db.run(
                `UPDATE positions
         SET quantity = ?, locked_quantity = ?, last_updated = ?
         WHERE position_id = ?`,
                [this.toSqlNumber(newQuantity), this.toSqlNumber(newLocked), this.now(), positionId],
            );
        }

        return true;
    }

    /**
     * Archive a position
     */
    archive(positionId: string): void {
        this.db.run(
            `UPDATE positions
       SET is_archived = 1, last_updated = ?
       WHERE position_id = ?`,
            [this.now(), positionId],
        );
    }

    /**
     * Create or update position
     */
    upsert(position: Position): void {
        const existing = this.getById(position.positionId);
        if (existing) {
            this.db.run(
                `UPDATE positions
         SET quantity = ?, locked_quantity = ?, avg_cost_basis = ?,
             is_archived = ?, last_updated = ?
         WHERE position_id = ?`,
                [
                    this.toSqlNumber(position.quantity),
                    this.toSqlNumber(position.lockedQuantity),
                    this.toSqlNumber(position.avgCostBasis),
                    this.toSqlBool(position.isArchived),
                    this.toSqlDate(position.lastUpdated),
                    position.positionId,
                ],
            );
        } else {
            this.create(position);
        }
    }

    /**
     * Delete a position (hard delete)
     */
    delete(positionId: string): void {
        this.db.run("DELETE FROM positions WHERE position_id = ?", [positionId]);
    }

    private rowToPosition(row: PositionRow): Position {
        return {
            positionId: row.position_id,
            userId: row.user_id,
            marketId: row.market_id,
            side: row.side as Position["side"],
            quantity: this.fromSqlNumber(row.quantity),
            lockedQuantity: this.fromSqlNumber(row.locked_quantity),
            avgCostBasis: this.fromSqlNumber(row.avg_cost_basis),
            isArchived: this.fromSqlBool(row.is_archived),
            lastUpdated: this.fromSqlDate(row.last_updated),
        };
    }
}
