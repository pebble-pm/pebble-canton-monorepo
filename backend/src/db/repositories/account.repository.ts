/**
 * Account repository for database operations
 */

import Decimal from "decimal.js";
import { BaseRepository } from "./base.repository";
import type { TradingAccount } from "../../types";

interface AccountRow {
    user_id: string;
    party_id: string;
    account_contract_id: string | null;
    authorization_contract_id: string | null;
    available_balance: number;
    locked_balance: number;
    last_updated: string;
}

export class AccountRepository extends BaseRepository {
    /**
     * Get account by user ID
     */
    getById(userId: string): TradingAccount | null {
        const row = this.db.query("SELECT * FROM accounts WHERE user_id = ?").get(userId) as AccountRow | null;

        return row ? this.rowToAccount(row) : null;
    }

    /**
     * Get account by party ID
     */
    getByPartyId(partyId: string): TradingAccount | null {
        const row = this.db.query("SELECT * FROM accounts WHERE party_id = ?").get(partyId) as AccountRow | null;

        return row ? this.rowToAccount(row) : null;
    }

    /**
     * Get all accounts
     */
    getAll(): TradingAccount[] {
        const rows = this.db.query("SELECT * FROM accounts ORDER BY user_id").all() as AccountRow[];

        return rows.map((row) => this.rowToAccount(row));
    }

    /**
     * Get accounts with stale data (for reconciliation)
     */
    getStaleAccounts(maxAgeMinutes: number): TradingAccount[] {
        const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();
        const rows = this.db.query("SELECT * FROM accounts WHERE last_updated < ?").all(cutoff) as AccountRow[];

        return rows.map((row) => this.rowToAccount(row));
    }

    /**
     * Create a new account
     */
    create(account: TradingAccount): void {
        this.db.run(
            `
      INSERT INTO accounts
      (user_id, party_id, account_contract_id, authorization_contract_id,
       available_balance, locked_balance, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
            [
                account.userId,
                account.partyId,
                account.accountContractId ?? null,
                account.authorizationContractId ?? null,
                this.toSqlNumber(account.availableBalance),
                this.toSqlNumber(account.lockedBalance),
                this.toSqlDate(account.lastUpdated),
            ],
        );
    }

    /**
     * Update account balances
     */
    updateBalances(userId: string, availableBalance: Decimal, lockedBalance: Decimal): void {
        this.db.run(
            `UPDATE accounts
       SET available_balance = ?, locked_balance = ?, last_updated = ?
       WHERE user_id = ?`,
            [this.toSqlNumber(availableBalance), this.toSqlNumber(lockedBalance), this.now(), userId],
        );
    }

    /**
     * Update contract IDs
     */
    updateContractIds(userId: string, accountContractId?: string, authorizationContractId?: string): void {
        this.db.run(
            `UPDATE accounts
       SET account_contract_id = ?, authorization_contract_id = ?, last_updated = ?
       WHERE user_id = ?`,
            [accountContractId ?? null, authorizationContractId ?? null, this.now(), userId],
        );
    }

    /**
     * Update just the account contract ID (after Canton exercises consuming choices)
     * Canton's UTXO model creates new contracts after each exercise
     */
    updateAccountContractId(userId: string, newContractId: string): void {
        this.db.run(
            `UPDATE accounts
       SET account_contract_id = ?, last_updated = ?
       WHERE user_id = ?`,
            [newContractId, this.now(), userId],
        );
    }

    /**
     * Lock funds (reduce available, increase locked)
     */
    lockFunds(userId: string, amount: Decimal): boolean {
        const account = this.getById(userId);
        if (!account || account.availableBalance.lt(amount)) {
            return false;
        }

        this.db.run(
            `UPDATE accounts
       SET available_balance = available_balance - ?,
           locked_balance = locked_balance + ?,
           last_updated = ?
       WHERE user_id = ?`,
            [this.toSqlNumber(amount), this.toSqlNumber(amount), this.now(), userId],
        );

        return true;
    }

    /**
     * Unlock funds (increase available, reduce locked)
     */
    unlockFunds(userId: string, amount: Decimal): boolean {
        const account = this.getById(userId);
        if (!account || account.lockedBalance.lt(amount)) {
            return false;
        }

        this.db.run(
            `UPDATE accounts
       SET available_balance = available_balance + ?,
           locked_balance = locked_balance - ?,
           last_updated = ?
       WHERE user_id = ?`,
            [this.toSqlNumber(amount), this.toSqlNumber(amount), this.now(), userId],
        );

        return true;
    }

    /**
     * Debit locked funds (reduce locked without affecting available)
     */
    debitLocked(userId: string, amount: Decimal): boolean {
        const account = this.getById(userId);
        if (!account || account.lockedBalance.lt(amount)) {
            return false;
        }

        this.db.run(
            `UPDATE accounts
       SET locked_balance = locked_balance - ?,
           last_updated = ?
       WHERE user_id = ?`,
            [this.toSqlNumber(amount), this.now(), userId],
        );

        return true;
    }

    /**
     * Credit available balance
     */
    creditAvailable(userId: string, amount: Decimal): void {
        this.db.run(
            `UPDATE accounts
       SET available_balance = available_balance + ?,
           last_updated = ?
       WHERE user_id = ?`,
            [this.toSqlNumber(amount), this.now(), userId],
        );
    }

    /**
     * Create or update an account
     */
    upsert(account: TradingAccount): void {
        const existing = this.getById(account.userId);
        if (existing) {
            this.updateBalances(account.userId, account.availableBalance, account.lockedBalance);
            this.updateContractIds(account.userId, account.accountContractId, account.authorizationContractId);
        } else {
            this.create(account);
        }
    }

    /**
     * Delete an account
     */
    delete(userId: string): void {
        this.db.run("DELETE FROM accounts WHERE user_id = ?", [userId]);
    }

    private rowToAccount(row: AccountRow): TradingAccount {
        return {
            userId: row.user_id,
            partyId: row.party_id,
            accountContractId: row.account_contract_id ?? undefined,
            authorizationContractId: row.authorization_contract_id ?? undefined,
            availableBalance: this.fromSqlNumber(row.available_balance),
            lockedBalance: this.fromSqlNumber(row.locked_balance),
            lastUpdated: this.fromSqlDate(row.last_updated),
        };
    }
}
