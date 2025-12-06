/**
 * Market repository for database operations
 */

import Decimal from "decimal.js";
import { BaseRepository } from "./base.repository";
import type { Market } from "../../types";

interface MarketRow {
    market_id: string;
    question: string;
    description: string | null;
    resolution_time: string;
    created_at: string;
    status: string;
    outcome: number | null;
    contract_id: string | null;
    version: number;
    yes_price: number;
    no_price: number;
    volume_24h: number;
    total_volume: number;
    open_interest: number;
    last_updated: string;
}

export class MarketRepository extends BaseRepository {
    /**
     * Get all active markets (not resolved)
     */
    getActiveMarkets(): Market[] {
        const rows = this.db.query("SELECT * FROM markets WHERE status != 'resolved' ORDER BY created_at DESC").all() as MarketRow[];

        return rows.map((row) => this.rowToMarket(row));
    }

    /**
     * Get all markets
     */
    getAllMarkets(): Market[] {
        const rows = this.db.query("SELECT * FROM markets ORDER BY created_at DESC").all() as MarketRow[];

        return rows.map((row) => this.rowToMarket(row));
    }

    /**
     * Get markets by status
     */
    getByStatus(status: Market["status"]): Market[] {
        const rows = this.db.query("SELECT * FROM markets WHERE status = ? ORDER BY created_at DESC").all(status) as MarketRow[];

        return rows.map((row) => this.rowToMarket(row));
    }

    /**
     * Get market by ID
     */
    getById(marketId: string): Market | null {
        const row = this.db.query("SELECT * FROM markets WHERE market_id = ?").get(marketId) as MarketRow | null;

        return row ? this.rowToMarket(row) : null;
    }

    /**
     * Create a new market
     */
    create(market: Market): void {
        this.db.run(
            `
      INSERT INTO markets
      (market_id, question, description, resolution_time, created_at, status,
       outcome, contract_id, version, yes_price, no_price, volume_24h,
       total_volume, open_interest, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
            [
                market.marketId,
                market.question,
                market.description,
                this.toSqlDate(market.resolutionTime),
                this.toSqlDate(market.createdAt),
                market.status,
                market.outcome !== undefined ? (market.outcome ? 1 : 0) : null,
                market.contractId ?? null,
                market.version ?? 0,
                this.toSqlNumber(market.yesPrice),
                this.toSqlNumber(market.noPrice),
                this.toSqlNumber(market.volume24h),
                this.toSqlNumber(market.totalVolume),
                this.toSqlNumber(market.openInterest),
                this.toSqlDate(market.lastUpdated),
            ],
        );
    }

    /**
     * Update an existing market
     */
    update(market: Market): void {
        this.db.run(
            `
      UPDATE markets SET
        question = ?,
        description = ?,
        resolution_time = ?,
        status = ?,
        outcome = ?,
        contract_id = ?,
        version = ?,
        yes_price = ?,
        no_price = ?,
        volume_24h = ?,
        total_volume = ?,
        open_interest = ?,
        last_updated = ?
      WHERE market_id = ?
    `,
            [
                market.question,
                market.description,
                this.toSqlDate(market.resolutionTime),
                market.status,
                market.outcome !== undefined ? (market.outcome ? 1 : 0) : null,
                market.contractId ?? null,
                market.version ?? 0,
                this.toSqlNumber(market.yesPrice),
                this.toSqlNumber(market.noPrice),
                this.toSqlNumber(market.volume24h),
                this.toSqlNumber(market.totalVolume),
                this.toSqlNumber(market.openInterest),
                this.toSqlDate(market.lastUpdated),
                market.marketId,
            ],
        );
    }

    /**
     * Create or update a market
     */
    upsert(market: Market): void {
        const existing = this.getById(market.marketId);
        if (existing) {
            this.update(market);
        } else {
            this.create(market);
        }
    }

    /**
     * Update market status
     */
    updateStatus(marketId: string, status: Market["status"], outcome?: boolean): void {
        if (outcome !== undefined) {
            this.db.run("UPDATE markets SET status = ?, outcome = ?, last_updated = ? WHERE market_id = ?", [
                status,
                outcome ? 1 : 0,
                this.now(),
                marketId,
            ]);
        } else {
            this.db.run("UPDATE markets SET status = ?, last_updated = ? WHERE market_id = ?", [status, this.now(), marketId]);
        }
    }

    /**
     * Update market prices and volume
     */
    updatePricing(marketId: string, yesPrice: Decimal, volume: Decimal): void {
        const noPrice = new Decimal(1).minus(yesPrice);
        this.db.run(
            `
      UPDATE markets
      SET yes_price = ?, no_price = ?,
          volume_24h = volume_24h + ?,
          total_volume = total_volume + ?,
          last_updated = ?
      WHERE market_id = ?
    `,
            [
                this.toSqlNumber(yesPrice),
                this.toSqlNumber(noPrice),
                this.toSqlNumber(volume),
                this.toSqlNumber(volume),
                this.now(),
                marketId,
            ],
        );
    }

    /**
     * Update market contract reference
     */
    updateContractId(marketId: string, contractId: string, version: number): void {
        this.db.run("UPDATE markets SET contract_id = ?, version = ?, last_updated = ? WHERE market_id = ?", [
            contractId,
            version,
            this.now(),
            marketId,
        ]);
    }

    /**
     * Delete a market (soft delete by setting status)
     */
    delete(marketId: string): void {
        this.db.run("DELETE FROM markets WHERE market_id = ?", [marketId]);
    }

    private rowToMarket(row: MarketRow): Market {
        return {
            marketId: row.market_id,
            question: row.question,
            description: row.description ?? "",
            resolutionTime: this.fromSqlDate(row.resolution_time),
            createdAt: this.fromSqlDate(row.created_at),
            status: row.status as Market["status"],
            outcome: row.outcome !== null ? row.outcome === 1 : undefined,
            contractId: row.contract_id ?? undefined,
            version: row.version,
            yesPrice: this.fromSqlNumber(row.yes_price),
            noPrice: this.fromSqlNumber(row.no_price),
            volume24h: this.fromSqlNumber(row.volume_24h),
            totalVolume: this.fromSqlNumber(row.total_volume),
            openInterest: this.fromSqlNumber(row.open_interest),
            lastUpdated: this.fromSqlDate(row.last_updated),
        };
    }
}
