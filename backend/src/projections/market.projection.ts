/**
 * Market Projection Service
 * Maintains off-chain market projections from Canton Market events
 */

import Decimal from "decimal.js";
import { BaseProjectionService } from "./base.projection";

// ============================================
// Types
// ============================================

/** Market status */
export type MarketStatus = "open" | "closed" | "resolved";

/** Market projection data */
export interface MarketProjection {
    marketId: string;
    contractId: string;
    question: string;
    description: string;
    resolutionTime: Date;
    createdAt: Date;
    status: MarketStatus;
    outcome?: boolean;
    version: number;
    yesPrice: Decimal;
    noPrice: Decimal;
    volume24h: Decimal;
    totalVolume: Decimal;
    openInterest: Decimal;
    lastUpdated: Date;
}

/** Row type from database query */
interface MarketRow {
    market_id: string;
    contract_id: string | null;
    question: string;
    description: string;
    resolution_time: string;
    created_at: string;
    status: string;
    outcome: number | null;
    version: number | null;
    yes_price: number;
    no_price: number;
    volume_24h: number;
    total_volume: number;
    open_interest: number;
    last_updated: string;
}

// ============================================
// Service
// ============================================

/**
 * Maintains off-chain market projections from Canton events
 *
 * This service is updated by the LedgerEventProcessor when Market
 * contracts are created or modified on Canton. It maintains a cached view
 * of market state for fast API queries.
 *
 * Key behavior:
 * - Markets are keyed by market_id (immutable identifier)
 * - Each market state change (close, resolve) creates a new contract version
 * - The version field tracks contract evolution for staleness detection
 */
export class MarketProjectionService extends BaseProjectionService {
    /**
     * Handle Market CREATE event
     * Updates the off-chain market cache with the new contract state
     *
     * @param contractId - The Canton contract ID of the new Market
     * @param marketId - The unique market identifier
     * @param question - The prediction market question
     * @param description - Market description
     * @param resolutionTime - When the market should be resolved
     * @param status - Current market status
     * @param outcome - Resolution outcome (only if resolved)
     * @param version - Contract version for staleness detection
     */
    async handleMarketCreated(
        contractId: string,
        marketId: string,
        question: string,
        description: string,
        resolutionTime: string,
        status: MarketStatus,
        outcome: boolean | undefined,
        version: number,
    ): Promise<void> {
        // Check if market exists (upsert pattern using market_id as key)
        const existing = this.db.query("SELECT market_id FROM markets WHERE market_id = ?").get(marketId) as { market_id: string } | null;

        if (existing) {
            // Update existing market with new contract version
            this.db.run(
                `UPDATE markets
         SET contract_id = ?,
             question = ?,
             description = ?,
             resolution_time = ?,
             status = ?,
             outcome = ?,
             version = ?,
             last_updated = ?
         WHERE market_id = ?`,
                [
                    contractId,
                    question,
                    description,
                    resolutionTime,
                    status,
                    outcome !== undefined ? this.toSqlBool(outcome) : null,
                    version,
                    this.now(),
                    marketId,
                ],
            );
        } else {
            // Create new market projection
            this.db.run(
                `INSERT INTO markets
         (market_id, question, description, resolution_time, created_at,
          status, outcome, contract_id, version, yes_price, no_price,
          volume_24h, total_volume, open_interest, last_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0.5, 0.5, 0, 0, 0, ?)`,
                [
                    marketId,
                    question,
                    description,
                    resolutionTime,
                    this.now(),
                    status,
                    outcome !== undefined ? this.toSqlBool(outcome) : null,
                    contractId,
                    version,
                    this.now(),
                ],
            );
        }

        console.log(`[MarketProjection] Updated market ${marketId}: status=${status}, version=${version}`);
    }

    /**
     * Handle MarketSettlement CREATE event (market resolved)
     * Updates the market to resolved status with the outcome
     *
     * @param marketId - The market that was resolved
     * @param outcome - The resolution outcome (true = YES wins, false = NO wins)
     */
    async handleMarketResolved(marketId: string, outcome: boolean): Promise<void> {
        this.db.run(
            `UPDATE markets
       SET status = 'resolved',
           outcome = ?,
           last_updated = ?
       WHERE market_id = ?`,
            [this.toSqlBool(outcome), this.now(), marketId],
        );

        console.log(`[MarketProjection] Market ${marketId} resolved: outcome=${outcome ? "YES" : "NO"}`);
    }

    /**
     * Update market pricing (called by matching engine after trades)
     */
    updatePricing(marketId: string, yesPrice: Decimal, volume: Decimal): void {
        this.db.run(
            `UPDATE markets
       SET yes_price = ?,
           no_price = ?,
           volume_24h = volume_24h + ?,
           total_volume = total_volume + ?,
           last_updated = ?
       WHERE market_id = ?`,
            [
                this.toSqlNumber(yesPrice),
                this.toSqlNumber(new Decimal(1).minus(yesPrice)),
                this.toSqlNumber(volume),
                this.toSqlNumber(volume),
                this.now(),
                marketId,
            ],
        );
    }

    /**
     * Update open interest (total outstanding positions)
     */
    updateOpenInterest(marketId: string, openInterest: Decimal): void {
        this.db.run(
            `UPDATE markets
       SET open_interest = ?,
           last_updated = ?
       WHERE market_id = ?`,
            [this.toSqlNumber(openInterest), this.now(), marketId],
        );
    }

    /**
     * Get market by ID
     */
    getById(marketId: string): MarketProjection | null {
        const row = this.db.query("SELECT * FROM markets WHERE market_id = ?").get(marketId) as MarketRow | null;

        if (!row) return null;

        return this.rowToProjection(row);
    }

    /**
     * Get market by contract ID
     */
    getByContractId(contractId: string): MarketProjection | null {
        const row = this.db.query("SELECT * FROM markets WHERE contract_id = ?").get(contractId) as MarketRow | null;

        if (!row) return null;

        return this.rowToProjection(row);
    }

    /**
     * Get all markets
     */
    getAll(): MarketProjection[] {
        const rows = this.db.query("SELECT * FROM markets").all() as MarketRow[];

        return rows.map((row) => this.rowToProjection(row));
    }

    /**
     * Get markets by status
     */
    getByStatus(status: MarketStatus): MarketProjection[] {
        const rows = this.db.query("SELECT * FROM markets WHERE status = ?").all(status) as MarketRow[];

        return rows.map((row) => this.rowToProjection(row));
    }

    /**
     * Get all active (open) markets
     */
    getActiveMarkets(): MarketProjection[] {
        return this.getByStatus("open");
    }

    /**
     * Get markets that need resolution (past resolution time, still open)
     */
    getMarketsNeedingResolution(): MarketProjection[] {
        const rows = this.db
            .query(
                `SELECT * FROM markets
         WHERE status = 'open' AND resolution_time <= ?`,
            )
            .all(this.now()) as MarketRow[];

        return rows.map((row) => this.rowToProjection(row));
    }

    /**
     * Convert database row to MarketProjection
     */
    private rowToProjection(row: MarketRow): MarketProjection {
        return {
            marketId: row.market_id,
            contractId: row.contract_id || "",
            question: row.question,
            description: row.description,
            resolutionTime: new Date(row.resolution_time),
            createdAt: new Date(row.created_at),
            status: row.status as MarketStatus,
            outcome: row.outcome !== null ? this.fromSqlBool(row.outcome) : undefined,
            version: row.version ?? 0,
            yesPrice: this.fromSqlNumber(row.yes_price),
            noPrice: this.fromSqlNumber(row.no_price),
            volume24h: this.fromSqlNumber(row.volume_24h),
            totalVolume: this.fromSqlNumber(row.total_volume),
            openInterest: this.fromSqlNumber(row.open_interest),
            lastUpdated: new Date(row.last_updated),
        };
    }
}
