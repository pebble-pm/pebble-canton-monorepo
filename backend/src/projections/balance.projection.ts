/**
 * Balance Projection Service
 * Maintains off-chain account balance projections from Canton TradingAccount events
 */

import Decimal from "decimal.js";
import { BaseProjectionService } from "./base.projection";

// ============================================
// Types
// ============================================

/** Account projection data */
export interface AccountProjection {
    userId: string;
    partyId: string;
    accountContractId: string;
    availableBalance: Decimal;
    lockedBalance: Decimal;
    lastUpdated: Date;
}

/** Row type from database query */
interface AccountRow {
    user_id: string;
    party_id: string;
    account_contract_id: string | null;
    available_balance: number;
    locked_balance: number;
    last_updated: string;
}

// ============================================
// Service
// ============================================

/**
 * Maintains off-chain account balance projections from Canton events
 *
 * This service is updated by the LedgerEventProcessor when TradingAccount
 * contracts are created or archived on Canton. It maintains a cached view
 * of user balances for fast API queries.
 */
export class BalanceProjectionService extends BaseProjectionService {
    /**
     * Handle TradingAccount CREATE event
     * Updates the off-chain balance cache with the new contract state
     *
     * @param contractId - The Canton contract ID of the new TradingAccount
     * @param owner - The party ID of the account owner
     * @param availableBalance - Available balance from the contract
     * @param lockedBalance - Locked balance from the contract
     */
    async handleAccountCreated(
        contractId: string,
        owner: string,
        availableBalance: string,
        lockedBalance: string,
    ): Promise<void> {
        const available = this.toDecimal(availableBalance);
        const locked = this.toDecimal(lockedBalance);

        // Check if account exists (upsert pattern using party_id as key)
        const existing = this.db.query("SELECT user_id FROM accounts WHERE party_id = ?").get(owner) as {
            user_id: string;
        } | null;

        if (existing) {
            // Update existing account with new contract version
            this.db.run(
                `UPDATE accounts
         SET account_contract_id = ?,
             available_balance = ?,
             locked_balance = ?,
             last_updated = ?
         WHERE party_id = ?`,
                [contractId, this.toSqlNumber(available), this.toSqlNumber(locked), this.now(), owner],
            );
        } else {
            // Create new account projection
            this.db.run(
                `INSERT INTO accounts
         (user_id, party_id, account_contract_id, available_balance,
          locked_balance, last_updated)
         VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    owner, // userId = partyId for simplicity in MVP
                    owner,
                    contractId,
                    this.toSqlNumber(available),
                    this.toSqlNumber(locked),
                    this.now(),
                ],
            );
        }

        console.log(
            `[BalanceProjection] Updated account ${owner.slice(0, 20)}...: ` +
                `available=${available.toFixed(4)}, locked=${locked.toFixed(4)}`,
        );
    }

    /**
     * Get account projection by party ID
     */
    getByPartyId(partyId: string): AccountProjection | null {
        const row = this.db.query("SELECT * FROM accounts WHERE party_id = ?").get(partyId) as AccountRow | null;

        if (!row) return null;

        return this.rowToProjection(row);
    }

    /**
     * Get account projection by user ID
     */
    getByUserId(userId: string): AccountProjection | null {
        const row = this.db.query("SELECT * FROM accounts WHERE user_id = ?").get(userId) as AccountRow | null;

        if (!row) return null;

        return this.rowToProjection(row);
    }

    /**
     * Get all account projections
     */
    getAll(): AccountProjection[] {
        const rows = this.db.query("SELECT * FROM accounts").all() as AccountRow[];

        return rows.map((row) => this.rowToProjection(row));
    }

    /**
     * Get accounts that may need reconciliation (stale)
     * An account is considered stale if it hasn't been updated recently
     *
     * @param maxAgeMinutes - Accounts older than this are considered stale
     */
    getStaleAccounts(maxAgeMinutes: number): AccountProjection[] {
        const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();

        const rows = this.db.query("SELECT * FROM accounts WHERE last_updated < ?").all(cutoff) as AccountRow[];

        return rows.map((row) => this.rowToProjection(row));
    }

    /**
     * Update account balances directly (used by reconciliation)
     */
    updateBalances(userId: string, availableBalance: Decimal, lockedBalance: Decimal): void {
        this.db.run(
            `UPDATE accounts
       SET available_balance = ?,
           locked_balance = ?,
           last_updated = ?
       WHERE user_id = ?`,
            [this.toSqlNumber(availableBalance), this.toSqlNumber(lockedBalance), this.now(), userId],
        );
    }

    /**
     * Convert database row to AccountProjection
     */
    private rowToProjection(row: AccountRow): AccountProjection {
        return {
            userId: row.user_id,
            partyId: row.party_id,
            accountContractId: row.account_contract_id || "",
            availableBalance: this.fromSqlNumber(row.available_balance),
            lockedBalance: this.fromSqlNumber(row.locked_balance),
            lastUpdated: new Date(row.last_updated),
        };
    }
}
