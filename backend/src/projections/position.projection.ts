/**
 * Position Projection Service
 * Maintains off-chain position projections from Canton Position events
 */

import Decimal from "decimal.js";
import { BaseProjectionService } from "./base.projection";

// ============================================
// Types
// ============================================

/** Position side (YES or NO) */
export type PositionSide = "yes" | "no";

/** Position projection data */
export interface PositionProjection {
    positionId: string;
    userId: string;
    marketId: string;
    side: PositionSide;
    quantity: Decimal;
    lockedQuantity: Decimal;
    avgCostBasis: Decimal;
    isArchived: boolean;
    lastUpdated: Date;
}

/** Row type from database query */
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

// ============================================
// Service
// ============================================

/**
 * Maintains off-chain position projections from Canton events
 *
 * This service is updated by the LedgerEventProcessor when Position
 * contracts are created or archived on Canton. It maintains a cached view
 * of user positions for fast API queries.
 *
 * Key behavior:
 * - Positions are keyed by (user_id, market_id, side), not by contractId
 * - When a Position contract evolves (archived + new created), we update the same record
 * - Positions are only marked as archived when quantity reaches 0
 */
export class PositionProjectionService extends BaseProjectionService {
    /**
     * Handle Position CREATE event
     * Updates the off-chain position cache with the new contract state
     *
     * @param contractId - The Canton contract ID of the new Position
     * @param owner - The party ID of the position owner
     * @param marketId - The market this position is for
     * @param side - YES or NO position
     * @param quantity - Total shares owned
     * @param lockedQuantity - Shares locked in pending sell orders
     * @param avgCostBasis - Average price paid per share
     */
    async handlePositionCreated(
        contractId: string,
        owner: string,
        marketId: string,
        side: PositionSide,
        quantity: string,
        lockedQuantity: string,
        avgCostBasis: string,
    ): Promise<void> {
        const qty = this.toDecimal(quantity);
        const locked = this.toDecimal(lockedQuantity);
        const costBasis = this.toDecimal(avgCostBasis);

        // Check for existing position by (user_id, market_id, side)
        // This handles the UTXO pattern where contracts evolve
        const existing = this.db
            .query(
                `SELECT position_id FROM positions
         WHERE user_id = ? AND market_id = ? AND side = ? AND is_archived = 0`,
            )
            .get(owner, marketId, side) as { position_id: string } | null;

        if (existing) {
            // Update existing position with new contract ID and values
            this.db.run(
                `UPDATE positions
         SET position_id = ?,
             quantity = ?,
             locked_quantity = ?,
             avg_cost_basis = ?,
             last_updated = ?
         WHERE user_id = ? AND market_id = ? AND side = ? AND is_archived = 0`,
                [
                    contractId,
                    this.toSqlNumber(qty),
                    this.toSqlNumber(locked),
                    this.toSqlNumber(costBasis),
                    this.now(),
                    owner,
                    marketId,
                    side,
                ],
            );
        } else {
            // Create new position projection
            this.db.run(
                `INSERT INTO positions
         (position_id, user_id, market_id, side, quantity, locked_quantity,
          avg_cost_basis, is_archived, last_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
                [
                    contractId,
                    owner,
                    marketId,
                    side,
                    this.toSqlNumber(qty),
                    this.toSqlNumber(locked),
                    this.toSqlNumber(costBasis),
                    this.now(),
                ],
            );
        }

        console.log(
            `[PositionProjection] Updated position ${owner.slice(0, 12)}.../${marketId}/${side}: ` +
                `qty=${qty.toFixed(4)}, locked=${locked.toFixed(4)}`,
        );
    }

    /**
     * Handle Position ARCHIVE event
     * Only archives the position if quantity is zero (fully closed)
     *
     * In Daml's UTXO model, positions are frequently archived and recreated
     * when modified. We only mark as archived when the position is truly closed
     * (quantity = 0), not when it's just being updated.
     *
     * @param contractId - The Canton contract ID being archived
     */
    async handlePositionArchived(contractId: string): Promise<void> {
        // Get current position state
        const position = this.db.query("SELECT quantity FROM positions WHERE position_id = ?").get(contractId) as {
            quantity: number;
        } | null;

        if (position && position.quantity <= 0) {
            // Position is fully closed, mark as archived
            this.db.run(
                `UPDATE positions
         SET is_archived = 1, last_updated = ?
         WHERE position_id = ?`,
                [this.now(), contractId],
            );
            console.log(`[PositionProjection] Archived position ${contractId.slice(0, 20)}...`);
        }
        // Note: If position has quantity > 0, a new contract will be created
        // and handlePositionCreated will be called with the new state
    }

    /**
     * Get position by contract ID
     */
    getByContractId(contractId: string): PositionProjection | null {
        const row = this.db.query("SELECT * FROM positions WHERE position_id = ?").get(contractId) as PositionRow | null;

        if (!row) return null;

        return this.rowToProjection(row);
    }

    /**
     * Get all active positions for a user
     */
    getByUser(userId: string): PositionProjection[] {
        const rows = this.db.query("SELECT * FROM positions WHERE user_id = ? AND is_archived = 0").all(userId) as PositionRow[];

        return rows.map((row) => this.rowToProjection(row));
    }

    /**
     * Get all positions for a market (both active and archived)
     */
    getByMarket(marketId: string): PositionProjection[] {
        const rows = this.db.query("SELECT * FROM positions WHERE market_id = ?").all(marketId) as PositionRow[];

        return rows.map((row) => this.rowToProjection(row));
    }

    /**
     * Get active positions for a user in a specific market
     */
    getUserMarketPositions(userId: string, marketId: string): PositionProjection[] {
        const rows = this.db
            .query(
                `SELECT * FROM positions
         WHERE user_id = ? AND market_id = ? AND is_archived = 0`,
            )
            .all(userId, marketId) as PositionRow[];

        return rows.map((row) => this.rowToProjection(row));
    }

    /**
     * Get a specific position by user, market, and side
     */
    getByUserMarketSide(userId: string, marketId: string, side: PositionSide): PositionProjection | null {
        const row = this.db
            .query(
                `SELECT * FROM positions
         WHERE user_id = ? AND market_id = ? AND side = ? AND is_archived = 0`,
            )
            .get(userId, marketId, side) as PositionRow | null;

        if (!row) return null;

        return this.rowToProjection(row);
    }

    /**
     * Get all active positions across all users
     */
    getAllActive(): PositionProjection[] {
        const rows = this.db.query("SELECT * FROM positions WHERE is_archived = 0").all() as PositionRow[];

        return rows.map((row) => this.rowToProjection(row));
    }

    /**
     * Convert database row to PositionProjection
     */
    private rowToProjection(row: PositionRow): PositionProjection {
        return {
            positionId: row.position_id,
            userId: row.user_id,
            marketId: row.market_id,
            side: row.side as PositionSide,
            quantity: this.fromSqlNumber(row.quantity),
            lockedQuantity: this.fromSqlNumber(row.locked_quantity),
            avgCostBasis: this.fromSqlNumber(row.avg_cost_basis),
            isArchived: this.fromSqlBool(row.is_archived),
            lastUpdated: new Date(row.last_updated),
        };
    }
}
