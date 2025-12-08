/**
 * Integration tests for Event Processing
 *
 * Tests Canton event processing and projection updates
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import Decimal from "decimal.js";
import { BalanceProjectionService } from "../../src/projections/balance.projection";
import { PositionProjectionService } from "../../src/projections/position.projection";
import { testId } from "../setup/test-env";

// ============================================
// Test Setup
// ============================================

let db: Database;
let balanceService: BalanceProjectionService;
let positionService: PositionProjectionService;

function setupDatabase(): Database {
    const database = new Database(":memory:");

    // Create accounts table (matching schema from balance.projection.ts)
    database.run(`
    CREATE TABLE accounts (
      user_id TEXT PRIMARY KEY,
      party_id TEXT NOT NULL,
      account_contract_id TEXT,
      available_balance REAL NOT NULL DEFAULT 0,
      locked_balance REAL NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL
    )
  `);

    // Create positions table
    database.run(`
    CREATE TABLE positions (
      position_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('yes', 'no')),
      quantity REAL NOT NULL DEFAULT 0,
      locked_quantity REAL NOT NULL DEFAULT 0,
      avg_cost_basis REAL NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL,
      UNIQUE(user_id, market_id, side, is_archived)
    )
  `);

    return database;
}

beforeEach(() => {
    db = setupDatabase();
    balanceService = new BalanceProjectionService(db);
    positionService = new PositionProjectionService(db);
});

afterEach(() => {
    db.close();
});

// ============================================
// Event Processing Tests
// ============================================

describe("Event Processing Integration", () => {
    describe("TradingAccount Events", () => {
        it("should process TradingAccount created event", async () => {
            const contractId = testId("account-contract");
            const userId = "party::alice";

            await balanceService.handleAccountCreated(
                contractId,
                userId,
                "1000", // initial balance
                "0",
            );

            const account = balanceService.getByUserId(userId);
            expect(account).not.toBeNull();
            expect(account!.userId).toBe(userId);
            expect(account!.availableBalance.equals(new Decimal(1000))).toBe(true);
            expect(account!.lockedBalance.equals(new Decimal(0))).toBe(true);
            expect(account!.accountContractId).toBe(contractId);
        });

        it("should process balance update events in sequence", async () => {
            const contractId = testId("account");
            const userId = "party::bob";

            // Create account
            await balanceService.handleAccountCreated(contractId, userId, "500", "0");

            // Lock funds for order (Canton UTXO pattern - new contract version)
            await balanceService.handleAccountCreated(
                testId("account-v2"),
                userId,
                "400", // available
                "100", // locked
            );

            const account = balanceService.getByUserId(userId);
            expect(account!.availableBalance.toNumber()).toBe(400);
            expect(account!.lockedBalance.toNumber()).toBe(100);

            // Trade settles - locked funds consumed (new contract version)
            await balanceService.handleAccountCreated(testId("account-v3"), userId, "400", "0");

            const updated = balanceService.getByUserId(userId);
            expect(updated!.availableBalance.toNumber()).toBe(400);
            expect(updated!.lockedBalance.toNumber()).toBe(0);
        });

        it("should handle deposit events", async () => {
            const contractId = testId("account");
            const userId = "party::charlie";

            await balanceService.handleAccountCreated(contractId, userId, "0", "0");

            // Deposit (Canton UTXO pattern - new contract version with updated balance)
            await balanceService.handleAccountCreated(testId("account-v2"), userId, "1000", "0");

            const account = balanceService.getByUserId(userId);
            expect(account!.availableBalance.toNumber()).toBe(1000);
        });

        it("should handle withdrawal events", async () => {
            const contractId = testId("account");
            const userId = "party::dave";

            await balanceService.handleAccountCreated(contractId, userId, "1000", "0");

            // Withdraw (Canton UTXO pattern - new contract version with reduced balance)
            await balanceService.handleAccountCreated(testId("account-v2"), userId, "700", "0");

            const account = balanceService.getByUserId(userId);
            expect(account!.availableBalance.toNumber()).toBe(700);
        });
    });

    describe("Position Events", () => {
        it("should process Position created event", async () => {
            const contractId = testId("position");
            const userId = "party::alice";
            const marketId = testId("market");

            await positionService.handlePositionCreated(contractId, userId, marketId, "yes", "100", "0", "0.55");

            const position = positionService.getByContractId(contractId);
            expect(position).not.toBeNull();
            expect(position!.userId).toBe(userId);
            expect(position!.marketId).toBe(marketId);
            expect(position!.side).toBe("yes");
            expect(position!.quantity.toNumber()).toBe(100);
            expect(position!.avgCostBasis.toNumber()).toBe(0.55);
        });

        it("should process Position update events (UTXO evolution)", async () => {
            const userId = "party::bob";
            const marketId = testId("market");

            // Initial position
            await positionService.handlePositionCreated(testId("pos-v1"), userId, marketId, "yes", "100", "0", "0.50");

            // Position updated after trade (UTXO pattern - new contract)
            await positionService.handlePositionCreated(testId("pos-v2"), userId, marketId, "yes", "150", "0", "0.53");

            // Should have one active position with updated values
            const positions = positionService.getByUser(userId);
            expect(positions.length).toBe(1);
            expect(positions[0].quantity.toNumber()).toBe(150);
            expect(positions[0].avgCostBasis.toNumber()).toBe(0.53);
        });

        it("should process Position archived event", async () => {
            const contractId = testId("position");
            const userId = "party::charlie";
            const marketId = testId("market");

            // Create position with zero quantity (fully sold)
            await positionService.handlePositionCreated(contractId, userId, marketId, "yes", "0", "0", "0.50");

            // Archive it
            await positionService.handlePositionArchived(contractId);

            const position = positionService.getByContractId(contractId);
            expect(position!.isArchived).toBe(true);

            // Should not appear in active positions
            const activePositions = positionService.getByUser(userId);
            expect(activePositions.length).toBe(0);
        });

        it("should track locked quantity correctly", async () => {
            const contractId1 = testId("pos-v1");
            const contractId2 = testId("pos-v2");
            const userId = "party::dave";
            const marketId = testId("market");

            // Create position
            await positionService.handlePositionCreated(contractId1, userId, marketId, "yes", "100", "0", "0.50");

            // Lock shares for sell order (new contract version)
            await positionService.handlePositionCreated(
                contractId2,
                userId,
                marketId,
                "yes",
                "100",
                "50", // 50 locked
                "0.50",
            );

            const position = positionService.getByContractId(contractId2);
            expect(position!.lockedQuantity.toNumber()).toBe(50);
        });
    });

    describe("Multi-Event Sequences", () => {
        it("should handle trading sequence correctly", async () => {
            const alice = "party::alice";
            const bob = "party::bob";
            const marketId = testId("market");

            // 1. Create accounts
            await balanceService.handleAccountCreated(testId("alice-acc"), alice, "1000", "0");
            await balanceService.handleAccountCreated(testId("bob-acc"), bob, "1000", "0");

            // 2. Alice locks funds for buy order (UTXO pattern - new contract)
            await balanceService.handleAccountCreated(testId("alice-acc-v2"), alice, "950", "50");

            // 3. Bob creates position (from previous trade)
            await positionService.handlePositionCreated(testId("bob-pos"), bob, marketId, "yes", "100", "0", "0.40");

            // 4. Bob locks shares for sell order
            await positionService.handlePositionCreated(
                testId("bob-pos-v2"),
                bob,
                marketId,
                "yes",
                "100",
                "50",
                "0.40",
            );

            // 5. Trade matches - Alice gets shares, Bob gets funds
            // Alice's locked funds consumed (UTXO pattern)
            await balanceService.handleAccountCreated(testId("alice-acc-v3"), alice, "950", "0");
            // Bob receives payment (UTXO pattern)
            await balanceService.handleAccountCreated(testId("bob-acc-v2"), bob, "1050", "0");
            // Alice gets position
            await positionService.handlePositionCreated(testId("alice-pos"), alice, marketId, "yes", "50", "0", "1.00");
            // Bob's position reduced
            await positionService.handlePositionCreated(testId("bob-pos-v3"), bob, marketId, "yes", "50", "0", "0.40");

            // Verify final state
            const aliceAcc = balanceService.getByUserId(alice)!;
            const bobAcc = balanceService.getByUserId(bob)!;
            const alicePos = positionService.getByUserMarketSide(alice, marketId, "yes")!;
            const bobPos = positionService.getByUserMarketSide(bob, marketId, "yes")!;

            expect(aliceAcc.availableBalance.toNumber()).toBe(950);
            expect(aliceAcc.lockedBalance.toNumber()).toBe(0);
            expect(bobAcc.availableBalance.toNumber()).toBe(1050);
            expect(alicePos.quantity.toNumber()).toBe(50);
            expect(bobPos.quantity.toNumber()).toBe(50);
        });

        it("should handle share creation sequence", async () => {
            const yesBuyer = "party::yes-buyer";
            const noBuyer = "party::no-buyer";
            const marketId = testId("market");

            // 1. Create accounts
            await balanceService.handleAccountCreated(testId("yes-acc"), yesBuyer, "1000", "0");
            await balanceService.handleAccountCreated(testId("no-acc"), noBuyer, "1000", "0");

            // 2. Both lock funds for orders (UTXO pattern)
            await balanceService.handleAccountCreated(testId("yes-acc-v2"), yesBuyer, "940", "60"); // 0.60 * 100
            await balanceService.handleAccountCreated(testId("no-acc-v2"), noBuyer, "960", "40"); // 0.40 * 100

            // 3. Share creation trade executes
            // Both locked funds consumed (UTXO pattern)
            await balanceService.handleAccountCreated(testId("yes-acc-v3"), yesBuyer, "940", "0");
            await balanceService.handleAccountCreated(testId("no-acc-v3"), noBuyer, "960", "0");

            // Both get positions
            await positionService.handlePositionCreated(
                testId("yes-pos"),
                yesBuyer,
                marketId,
                "yes",
                "100",
                "0",
                "0.60",
            );
            await positionService.handlePositionCreated(testId("no-pos"), noBuyer, marketId, "no", "100", "0", "0.40");

            // Verify final state
            const yesBuyerAcc = balanceService.getByUserId(yesBuyer)!;
            const noBuyerAcc = balanceService.getByUserId(noBuyer)!;
            const yesPos = positionService.getByUserMarketSide(yesBuyer, marketId, "yes")!;
            const noPos = positionService.getByUserMarketSide(noBuyer, marketId, "no")!;

            expect(yesBuyerAcc.availableBalance.toNumber()).toBe(940);
            expect(noBuyerAcc.availableBalance.toNumber()).toBe(960);
            expect(yesPos.quantity.toNumber()).toBe(100);
            expect(noPos.quantity.toNumber()).toBe(100);
            expect(yesPos.avgCostBasis.toNumber()).toBe(0.6);
            expect(noPos.avgCostBasis.toNumber()).toBe(0.4);
        });
    });

    describe("Event Idempotency", () => {
        it("should handle duplicate account events gracefully", async () => {
            const contractId = testId("account");
            const userId = "party::alice";

            // Process same event twice
            await balanceService.handleAccountCreated(contractId, userId, "1000", "0");
            await balanceService.handleAccountCreated(contractId, userId, "1000", "0");

            const accounts = db.query("SELECT * FROM accounts WHERE user_id = ?").all(userId);
            expect(accounts.length).toBe(1);
        });

        it("should handle duplicate position events gracefully", async () => {
            const contractId = testId("position");
            const userId = "party::bob";
            const marketId = testId("market");

            // Process same event twice
            await positionService.handlePositionCreated(contractId, userId, marketId, "yes", "100", "0", "0.50");
            await positionService.handlePositionCreated(contractId, userId, marketId, "yes", "100", "0", "0.50");

            const positions = db.query("SELECT * FROM positions WHERE position_id = ?").all(contractId);
            expect(positions.length).toBe(1);
        });
    });

    describe("Error Handling", () => {
        it("should handle archive of non-existent position gracefully", async () => {
            // Should not throw
            await positionService.handlePositionArchived("nonexistent-contract-id");
            expect(true).toBe(true);
        });

        it("should handle account event for non-existent account by creating it", async () => {
            const contractId = testId("account");
            const userId = "party::new-user";

            // Account created event - should create the account
            await balanceService.handleAccountCreated(contractId, userId, "500", "0");

            const account = balanceService.getByUserId(userId);
            expect(account).not.toBeNull();
            expect(account!.availableBalance.toNumber()).toBe(500);
        });
    });

    describe("Concurrent Events", () => {
        it("should handle multiple users' events correctly", async () => {
            const users = ["alice", "bob", "charlie", "dave", "eve"];
            const marketId = testId("market");

            // Create accounts for all users
            await Promise.all(
                users.map((user) =>
                    balanceService.handleAccountCreated(testId(`${user}-acc`), `party::${user}`, "1000", "0"),
                ),
            );

            // Create positions for all users
            await Promise.all(
                users.map((user, i) =>
                    positionService.handlePositionCreated(
                        testId(`${user}-pos`),
                        `party::${user}`,
                        marketId,
                        i % 2 === 0 ? "yes" : "no",
                        String(100 + i * 10),
                        "0",
                        String(0.5 + i * 0.02),
                    ),
                ),
            );

            // Verify all accounts and positions created
            for (const user of users) {
                const account = balanceService.getByUserId(`party::${user}`);
                expect(account).not.toBeNull();
                expect(account!.availableBalance.toNumber()).toBe(1000);
            }

            const marketPositions = positionService.getByMarket(marketId);
            expect(marketPositions.length).toBe(5);
        });
    });
});
