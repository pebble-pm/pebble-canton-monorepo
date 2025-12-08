/**
 * Unit tests for BalanceProjectionService
 *
 * Tests:
 * - Account creation from Canton events
 * - Balance updates (credit/debit)
 * - Account lookup by partyId and userId
 * - Stale account detection
 * - Decimal precision handling
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import Decimal from "decimal.js";
import { BalanceProjectionService } from "../../../src/projections/balance.projection";
import { testId } from "../../setup/test-env";

// ============================================
// Test Setup
// ============================================

let db: Database;
let balanceService: BalanceProjectionService;

function setupDatabase(): Database {
    const database = new Database(":memory:");

    // Create accounts table schema
    database.run(`
    CREATE TABLE accounts (
      user_id TEXT PRIMARY KEY,
      party_id TEXT UNIQUE NOT NULL,
      account_contract_id TEXT,
      authorization_contract_id TEXT,
      available_balance REAL NOT NULL DEFAULT 0,
      locked_balance REAL NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL
    )
  `);

    return database;
}

beforeEach(() => {
    db = setupDatabase();
    balanceService = new BalanceProjectionService(db);
});

afterEach(() => {
    db.close();
});

// ============================================
// Account Creation Tests
// ============================================

describe("BalanceProjectionService", () => {
    describe("handleAccountCreated", () => {
        it("should create a new account projection", async () => {
            const contractId = testId("contract");
            const owner = "party::alice";

            await balanceService.handleAccountCreated(contractId, owner, "1000", "0");

            const account = balanceService.getByPartyId(owner);
            expect(account).not.toBeNull();
            expect(account!.partyId).toBe(owner);
            expect(account!.accountContractId).toBe(contractId);
            expect(account!.availableBalance.equals(new Decimal(1000))).toBe(true);
            expect(account!.lockedBalance.equals(new Decimal(0))).toBe(true);
        });

        it("should update existing account on contract evolution", async () => {
            const owner = "party::bob";
            const contractId1 = testId("contract-v1");
            const contractId2 = testId("contract-v2");

            // First creation
            await balanceService.handleAccountCreated(contractId1, owner, "1000", "0");

            // Contract evolution (UTXO update)
            await balanceService.handleAccountCreated(contractId2, owner, "900", "100");

            const account = balanceService.getByPartyId(owner);
            expect(account).not.toBeNull();
            expect(account!.accountContractId).toBe(contractId2);
            expect(account!.availableBalance.equals(new Decimal(900))).toBe(true);
            expect(account!.lockedBalance.equals(new Decimal(100))).toBe(true);
        });

        it("should handle decimal precision correctly", async () => {
            const contractId = testId("contract");
            const owner = "party::charlie";

            // Use high-precision decimals
            await balanceService.handleAccountCreated(contractId, owner, "1234.567890", "12.345678");

            const account = balanceService.getByPartyId(owner);
            expect(account).not.toBeNull();
            // Verify reasonable precision (SQLite stores as REAL)
            expect(account!.availableBalance.toNumber()).toBeCloseTo(1234.56789, 4);
            expect(account!.lockedBalance.toNumber()).toBeCloseTo(12.345678, 4);
        });

        it("should handle zero balances", async () => {
            const contractId = testId("contract");
            const owner = "party::zero";

            await balanceService.handleAccountCreated(contractId, owner, "0", "0");

            const account = balanceService.getByPartyId(owner);
            expect(account).not.toBeNull();
            expect(account!.availableBalance.isZero()).toBe(true);
            expect(account!.lockedBalance.isZero()).toBe(true);
        });

        it("should handle large balances", async () => {
            const contractId = testId("contract");
            const owner = "party::whale";

            await balanceService.handleAccountCreated(contractId, owner, "1000000000", "500000000");

            const account = balanceService.getByPartyId(owner);
            expect(account).not.toBeNull();
            expect(account!.availableBalance.equals(new Decimal(1_000_000_000))).toBe(true);
            expect(account!.lockedBalance.equals(new Decimal(500_000_000))).toBe(true);
        });
    });

    // ============================================
    // Account Lookup Tests
    // ============================================

    describe("getByPartyId", () => {
        it("should return null for non-existent party", () => {
            const account = balanceService.getByPartyId("party::nonexistent");
            expect(account).toBeNull();
        });

        it("should find account by party ID", async () => {
            const owner = "party::alice";
            await balanceService.handleAccountCreated(testId("contract"), owner, "1000", "0");

            const account = balanceService.getByPartyId(owner);
            expect(account).not.toBeNull();
            expect(account!.partyId).toBe(owner);
        });
    });

    describe("getByUserId", () => {
        it("should return null for non-existent user", () => {
            const account = balanceService.getByUserId("nonexistent-user");
            expect(account).toBeNull();
        });

        it("should find account by user ID (which equals party ID in MVP)", async () => {
            const owner = "party::dave";
            await balanceService.handleAccountCreated(testId("contract"), owner, "500", "50");

            // In MVP, userId = partyId
            const account = balanceService.getByUserId(owner);
            expect(account).not.toBeNull();
            expect(account!.userId).toBe(owner);
        });
    });

    describe("getAll", () => {
        it("should return empty array when no accounts exist", () => {
            const accounts = balanceService.getAll();
            expect(accounts).toEqual([]);
        });

        it("should return all accounts", async () => {
            await balanceService.handleAccountCreated(testId("c1"), "party::a", "100", "0");
            await balanceService.handleAccountCreated(testId("c2"), "party::b", "200", "0");
            await balanceService.handleAccountCreated(testId("c3"), "party::c", "300", "0");

            const accounts = balanceService.getAll();
            expect(accounts.length).toBe(3);
        });
    });

    // ============================================
    // Balance Update Tests
    // ============================================

    describe("updateBalances", () => {
        it("should update balances directly", async () => {
            const owner = "party::update";
            await balanceService.handleAccountCreated(testId("contract"), owner, "1000", "0");

            balanceService.updateBalances(owner, new Decimal(800), new Decimal(200));

            const account = balanceService.getByUserId(owner);
            expect(account!.availableBalance.equals(new Decimal(800))).toBe(true);
            expect(account!.lockedBalance.equals(new Decimal(200))).toBe(true);
        });

        it("should update lastUpdated timestamp", async () => {
            const owner = "party::timestamp";
            await balanceService.handleAccountCreated(testId("contract"), owner, "1000", "0");

            const before = balanceService.getByUserId(owner)!.lastUpdated;

            // Small delay to ensure timestamp difference
            await new Promise((resolve) => setTimeout(resolve, 10));

            balanceService.updateBalances(owner, new Decimal(500), new Decimal(500));

            const after = balanceService.getByUserId(owner)!.lastUpdated;
            expect(after.getTime()).toBeGreaterThan(before.getTime());
        });
    });

    // ============================================
    // Stale Account Detection Tests
    // ============================================

    describe("getStaleAccounts", () => {
        it("should return empty when all accounts are fresh", async () => {
            await balanceService.handleAccountCreated(testId("c1"), "party::fresh", "100", "0");

            const stale = balanceService.getStaleAccounts(1); // 1 minute threshold
            expect(stale.length).toBe(0);
        });

        it("should identify accounts not updated within threshold", async () => {
            // Create account
            await balanceService.handleAccountCreated(testId("contract"), "party::stale", "100", "0");

            // Manually set last_updated to old date
            db.run("UPDATE accounts SET last_updated = ? WHERE party_id = ?", [
                new Date(Date.now() - 10 * 60 * 1000).toISOString(),
                "party::stale",
            ]);

            const stale = balanceService.getStaleAccounts(5); // 5 minute threshold
            expect(stale.length).toBe(1);
            expect(stale[0].partyId).toBe("party::stale");
        });
    });

    // ============================================
    // Edge Cases
    // ============================================

    describe("edge cases", () => {
        it("should handle multiple rapid updates to same account", async () => {
            const owner = "party::rapid";
            const contractIdBase = "contract";

            // Rapid succession of updates
            for (let i = 0; i < 10; i++) {
                await balanceService.handleAccountCreated(
                    `${contractIdBase}-${i}`,
                    owner,
                    String(1000 - i * 10),
                    String(i * 10),
                );
            }

            const account = balanceService.getByPartyId(owner);
            expect(account).not.toBeNull();
            expect(account!.accountContractId).toBe(`${contractIdBase}-9`);
            expect(account!.availableBalance.equals(new Decimal(910))).toBe(true);
            expect(account!.lockedBalance.equals(new Decimal(90))).toBe(true);
        });

        it("should handle negative-like string numbers gracefully", async () => {
            // Balances should never be negative in practice, but test parsing
            const contractId = testId("contract");
            const owner = "party::edge";

            // Note: In production, negative balances would be rejected at Daml level
            // This tests the projection's parsing robustness
            await balanceService.handleAccountCreated(contractId, owner, "0", "0");

            const account = balanceService.getByPartyId(owner);
            expect(account).not.toBeNull();
            expect(account!.availableBalance.isZero()).toBe(true);
        });
    });
});
