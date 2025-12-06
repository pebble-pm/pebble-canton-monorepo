/**
 * Unit tests for PositionProjectionService
 *
 * Tests:
 * - Position creation from Canton events
 * - Position updates (UTXO evolution)
 * - Position archival
 * - Position lookup by various keys
 * - Cost basis tracking
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import Decimal from "decimal.js";
import { PositionProjectionService } from "../../../src/projections/position.projection";
import { testId } from "../../setup/test-env";

// ============================================
// Test Setup
// ============================================

let db: Database;
let positionService: PositionProjectionService;

function setupDatabase(): Database {
    const database = new Database(":memory:");

    // Create positions table schema
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
    positionService = new PositionProjectionService(db);
});

afterEach(() => {
    db.close();
});

// ============================================
// Position Creation Tests
// ============================================

describe("PositionProjectionService", () => {
    describe("handlePositionCreated", () => {
        it("should create a new position projection", async () => {
            const contractId = testId("position-contract");
            const owner = "party::alice";
            const marketId = testId("market");

            await positionService.handlePositionCreated(contractId, owner, marketId, "yes", "100", "0", "0.55");

            const position = positionService.getByContractId(contractId);
            expect(position).not.toBeNull();
            expect(position!.positionId).toBe(contractId);
            expect(position!.userId).toBe(owner);
            expect(position!.marketId).toBe(marketId);
            expect(position!.side).toBe("yes");
            expect(position!.quantity.equals(new Decimal(100))).toBe(true);
            expect(position!.lockedQuantity.equals(new Decimal(0))).toBe(true);
            expect(position!.avgCostBasis.equals(new Decimal(0.55))).toBe(true);
            expect(position!.isArchived).toBe(false);
        });

        it("should update existing position on contract evolution (UTXO pattern)", async () => {
            const owner = "party::bob";
            const marketId = testId("market");
            const contractId1 = testId("position-v1");
            const contractId2 = testId("position-v2");

            // Initial position creation
            await positionService.handlePositionCreated(contractId1, owner, marketId, "yes", "100", "0", "0.50");

            // Position evolves (e.g., after partial sell)
            await positionService.handlePositionCreated(contractId2, owner, marketId, "yes", "60", "0", "0.50");

            // Should only have one active position
            const positions = positionService.getByUser(owner);
            expect(positions.length).toBe(1);
            expect(positions[0].positionId).toBe(contractId2);
            expect(positions[0].quantity.equals(new Decimal(60))).toBe(true);
        });

        it("should handle YES and NO positions separately", async () => {
            const owner = "party::charlie";
            const marketId = testId("market");

            // Create YES position
            await positionService.handlePositionCreated(testId("yes-pos"), owner, marketId, "yes", "100", "0", "0.60");

            // Create NO position
            await positionService.handlePositionCreated(testId("no-pos"), owner, marketId, "no", "50", "0", "0.40");

            const positions = positionService.getUserMarketPositions(owner, marketId);
            expect(positions.length).toBe(2);

            const yesPos = positions.find((p) => p.side === "yes");
            const noPos = positions.find((p) => p.side === "no");

            expect(yesPos).not.toBeNull();
            expect(noPos).not.toBeNull();
            expect(yesPos!.quantity.equals(new Decimal(100))).toBe(true);
            expect(noPos!.quantity.equals(new Decimal(50))).toBe(true);
        });

        it("should track locked quantity correctly", async () => {
            const contractId = testId("position");
            const owner = "party::dave";
            const marketId = testId("market");

            await positionService.handlePositionCreated(contractId, owner, marketId, "yes", "100", "30", "0.50");

            const position = positionService.getByContractId(contractId);
            expect(position!.quantity.equals(new Decimal(100))).toBe(true);
            expect(position!.lockedQuantity.equals(new Decimal(30))).toBe(true);
        });

        it("should handle decimal precision for cost basis", async () => {
            const contractId = testId("position");
            const owner = "party::eve";
            const marketId = testId("market");

            await positionService.handlePositionCreated(contractId, owner, marketId, "yes", "100", "0", "0.123456789");

            const position = positionService.getByContractId(contractId);
            expect(position!.avgCostBasis.toNumber()).toBeCloseTo(0.123456789, 6);
        });
    });

    // ============================================
    // Position Archival Tests
    // ============================================

    describe("handlePositionArchived", () => {
        it("should archive position when quantity is zero", async () => {
            const contractId = testId("position");
            const owner = "party::frank";
            const marketId = testId("market");

            // Create position with zero quantity (fully closed)
            await positionService.handlePositionCreated(contractId, owner, marketId, "yes", "0", "0", "0.50");

            // Archive the position
            await positionService.handlePositionArchived(contractId);

            const position = positionService.getByContractId(contractId);
            expect(position).not.toBeNull();
            expect(position!.isArchived).toBe(true);
        });

        it("should NOT archive position when quantity is positive", async () => {
            const contractId = testId("position");
            const owner = "party::grace";
            const marketId = testId("market");

            // Create position with positive quantity
            await positionService.handlePositionCreated(contractId, owner, marketId, "yes", "100", "0", "0.50");

            // Try to archive (simulating UTXO archive before new contract created)
            await positionService.handlePositionArchived(contractId);

            const position = positionService.getByContractId(contractId);
            expect(position).not.toBeNull();
            // Position should NOT be archived because quantity > 0
            expect(position!.isArchived).toBe(false);
        });

        it("should handle archive of non-existent contract gracefully", async () => {
            // Should not throw
            await positionService.handlePositionArchived("nonexistent-contract-id");
        });
    });

    // ============================================
    // Position Lookup Tests
    // ============================================

    describe("getByContractId", () => {
        it("should return null for non-existent contract", () => {
            const position = positionService.getByContractId("nonexistent");
            expect(position).toBeNull();
        });
    });

    describe("getByUser", () => {
        it("should return empty array for user with no positions", () => {
            const positions = positionService.getByUser("nobody");
            expect(positions).toEqual([]);
        });

        it("should return all active positions for user", async () => {
            const owner = "party::henry";
            const market1 = testId("market1");
            const market2 = testId("market2");

            await positionService.handlePositionCreated(testId("p1"), owner, market1, "yes", "100", "0", "0.50");
            await positionService.handlePositionCreated(testId("p2"), owner, market2, "no", "50", "0", "0.60");

            const positions = positionService.getByUser(owner);
            expect(positions.length).toBe(2);
        });

        it("should NOT return archived positions", async () => {
            const owner = "party::ivan";
            const marketId = testId("market");
            const archivedContractId = testId("archived");

            // Create and archive a position (must have zero quantity to be archivable)
            await positionService.handlePositionCreated(archivedContractId, owner, marketId, "yes", "0", "0", "0.50");
            await positionService.handlePositionArchived(archivedContractId);

            // Verify position is archived
            const archivedPos = positionService.getByContractId(archivedContractId);
            expect(archivedPos!.isArchived).toBe(true);

            // Create an active position (different side in same market)
            await positionService.handlePositionCreated(
                testId("active"),
                owner,
                marketId,
                "no", // Different side, so it's a separate position
                "100",
                "0",
                "0.50",
            );

            // getByUser should only return active (non-archived) positions
            const positions = positionService.getByUser(owner);
            expect(positions.length).toBe(1);
            expect(positions[0].isArchived).toBe(false);
            expect(positions[0].side).toBe("no");
        });
    });

    describe("getByMarket", () => {
        it("should return all positions in a market", async () => {
            const marketId = testId("market");

            await positionService.handlePositionCreated(testId("p1"), "party::user1", marketId, "yes", "100", "0", "0.50");
            await positionService.handlePositionCreated(testId("p2"), "party::user2", marketId, "no", "50", "0", "0.50");

            const positions = positionService.getByMarket(marketId);
            expect(positions.length).toBe(2);
        });

        it("should include archived positions in market query", async () => {
            const marketId = testId("market");

            await positionService.handlePositionCreated(testId("p1"), "party::user1", marketId, "yes", "0", "0", "0.50");
            await positionService.handlePositionArchived(testId("p1"));

            await positionService.handlePositionCreated(testId("p2"), "party::user2", marketId, "no", "50", "0", "0.50");

            const positions = positionService.getByMarket(marketId);
            expect(positions.length).toBe(2);
        });
    });

    describe("getByUserMarketSide", () => {
        it("should return null when position does not exist", () => {
            const position = positionService.getByUserMarketSide("party::nobody", "market", "yes");
            expect(position).toBeNull();
        });

        it("should return specific position by user, market, and side", async () => {
            const owner = "party::julia";
            const marketId = testId("market");

            await positionService.handlePositionCreated(testId("yes-pos"), owner, marketId, "yes", "100", "0", "0.55");
            await positionService.handlePositionCreated(testId("no-pos"), owner, marketId, "no", "50", "0", "0.45");

            const yesPos = positionService.getByUserMarketSide(owner, marketId, "yes");
            const noPos = positionService.getByUserMarketSide(owner, marketId, "no");

            expect(yesPos).not.toBeNull();
            expect(noPos).not.toBeNull();
            expect(yesPos!.side).toBe("yes");
            expect(noPos!.side).toBe("no");
            expect(yesPos!.quantity.equals(new Decimal(100))).toBe(true);
            expect(noPos!.quantity.equals(new Decimal(50))).toBe(true);
        });
    });

    describe("getAllActive", () => {
        it("should return all non-archived positions", async () => {
            const marketId = testId("market");

            await positionService.handlePositionCreated(testId("p1"), "party::a", marketId, "yes", "100", "0", "0.50");
            await positionService.handlePositionCreated(testId("p2"), "party::b", marketId, "no", "50", "0", "0.50");

            const active = positionService.getAllActive();
            expect(active.length).toBe(2);
            expect(active.every((p) => !p.isArchived)).toBe(true);
        });
    });

    // ============================================
    // Edge Cases
    // ============================================

    describe("edge cases", () => {
        it("should handle positions across multiple markets", async () => {
            const owner = "party::multimarket";

            for (let i = 0; i < 5; i++) {
                await positionService.handlePositionCreated(
                    testId(`p${i}`),
                    owner,
                    testId(`market${i}`),
                    i % 2 === 0 ? "yes" : "no",
                    String(100 + i * 10),
                    "0",
                    String(0.5 + i * 0.01),
                );
            }

            const positions = positionService.getByUser(owner);
            expect(positions.length).toBe(5);
        });

        it("should handle rapid UTXO updates", async () => {
            const owner = "party::rapid";
            const marketId = testId("market");

            // Simulate rapid trading causing multiple contract updates
            for (let i = 0; i < 10; i++) {
                await positionService.handlePositionCreated(testId(`pos-v${i}`), owner, marketId, "yes", String(100 - i * 5), "0", "0.50");
            }

            const positions = positionService.getByUser(owner);
            expect(positions.length).toBe(1);
            expect(positions[0].quantity.equals(new Decimal(55))).toBe(true);
        });

        it("should handle fractional share quantities", async () => {
            const contractId = testId("position");
            const owner = "party::fractional";
            const marketId = testId("market");

            await positionService.handlePositionCreated(contractId, owner, marketId, "yes", "123.456", "12.345", "0.567");

            const position = positionService.getByContractId(contractId);
            expect(position!.quantity.toNumber()).toBeCloseTo(123.456, 2);
            expect(position!.lockedQuantity.toNumber()).toBeCloseTo(12.345, 2);
        });

        it("should handle zero cost basis", async () => {
            const contractId = testId("position");
            const owner = "party::zerocost";
            const marketId = testId("market");

            await positionService.handlePositionCreated(contractId, owner, marketId, "yes", "100", "0", "0");

            const position = positionService.getByContractId(contractId);
            expect(position!.avgCostBasis.isZero()).toBe(true);
        });
    });
});
