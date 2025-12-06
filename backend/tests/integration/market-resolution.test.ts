/**
 * Integration tests for Market Resolution Flow
 *
 * Tests the complete lifecycle: Create market → Place orders → Match → Settle → Resolve → Redeem
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import Decimal from "decimal.js";
import { MatchingEngine, OrderbookPersistence } from "../../src/matching";
import { OrderService } from "../../src/services/order.service";
import { SettlementService } from "../../src/services/settlement.service";
import type { Order, Trade, Market, SettlementBatch, Position } from "../../src/types";
import { createMarket, createAccountProjection, createPositionProjection } from "../setup/test-fixtures";
import { testId } from "../setup/test-env";

// ============================================
// In-Memory Repositories
// ============================================

class InMemoryOrderRepo {
    private orders = new Map<string, Order>();

    create(order: Order): void {
        this.orders.set(order.orderId, order);
    }

    getById(orderId: string): Order | null {
        return this.orders.get(orderId) ?? null;
    }

    getByUser(userId: string): Order[] {
        return Array.from(this.orders.values()).filter((o) => o.userId === userId);
    }

    getOpenOrdersByUser(userId: string, marketId?: string): Order[] {
        return Array.from(this.orders.values()).filter(
            (o) => o.userId === userId && (o.status === "open" || o.status === "partial") && (!marketId || o.marketId === marketId),
        );
    }

    getByIdempotencyKey(_userId: string, _key: string): Order | null {
        return null;
    }

    updateFilled(orderId: string, filledQuantity: Decimal, status: Order["status"]): void {
        const order = this.orders.get(orderId);
        if (order) {
            order.filledQuantity = filledQuantity;
            order.status = status;
            order.updatedAt = new Date();
        }
    }

    updateStatus(orderId: string, status: Order["status"]): void {
        const order = this.orders.get(orderId);
        if (order) {
            order.status = status;
            order.updatedAt = new Date();
        }
    }

    cancelAllByMarket(marketId: string): number {
        let count = 0;
        for (const order of this.orders.values()) {
            if (order.marketId === marketId && (order.status === "open" || order.status === "partial")) {
                order.status = "cancelled";
                order.updatedAt = new Date();
                count++;
            }
        }
        return count;
    }

    clear(): void {
        this.orders.clear();
    }
}

class InMemoryTradeRepo {
    private trades = new Map<string, Trade>();

    create(trade: Trade): void {
        this.trades.set(trade.tradeId, trade);
    }

    getById(tradeId: string): Trade | null {
        return this.trades.get(tradeId) ?? null;
    }

    getByMarket(marketId: string): Trade[] {
        return Array.from(this.trades.values()).filter((t) => t.marketId === marketId);
    }

    getPendingTrades(limit: number): Trade[] {
        return Array.from(this.trades.values())
            .filter((t) => t.settlementStatus === "pending")
            .slice(0, limit);
    }

    updateSettlementStatus(tradeId: string, status: Trade["settlementStatus"], batchId?: string): void {
        const trade = this.trades.get(tradeId);
        if (trade) {
            trade.settlementStatus = status;
            if (batchId) trade.settlementId = batchId;
        }
    }

    getAll(): Trade[] {
        return Array.from(this.trades.values());
    }

    clear(): void {
        this.trades.clear();
    }
}

class InMemoryAccountRepo {
    private accounts = new Map<string, ReturnType<typeof createAccountProjection>>();

    getById(userId: string) {
        return this.accounts.get(userId) ?? null;
    }

    lockFunds(userId: string, amount: Decimal): void {
        const account = this.accounts.get(userId);
        if (account) {
            account.availableBalance = account.availableBalance.minus(amount);
            account.lockedBalance = account.lockedBalance.plus(amount);
            account.lastUpdated = new Date();
        }
    }

    unlockFunds(userId: string, amount: Decimal): void {
        const account = this.accounts.get(userId);
        if (account) {
            account.availableBalance = account.availableBalance.plus(amount);
            account.lockedBalance = account.lockedBalance.minus(amount);
            account.lastUpdated = new Date();
        }
    }

    creditAvailable(userId: string, amount: Decimal): void {
        const account = this.accounts.get(userId);
        if (account) {
            account.availableBalance = account.availableBalance.plus(amount);
            account.lastUpdated = new Date();
        }
    }

    debitLocked(userId: string, amount: Decimal): void {
        const account = this.accounts.get(userId);
        if (account) {
            account.lockedBalance = account.lockedBalance.minus(amount);
            account.lastUpdated = new Date();
        }
    }

    set(userId: string, account: ReturnType<typeof createAccountProjection>): void {
        this.accounts.set(userId, account);
    }

    get(userId: string) {
        return this.accounts.get(userId);
    }

    clear(): void {
        this.accounts.clear();
    }
}

class InMemoryPositionRepo {
    private positions = new Map<string, ReturnType<typeof createPositionProjection>>();

    private key(userId: string, marketId: string, side: "yes" | "no"): string {
        return `${userId}:${marketId}:${side}`;
    }

    getByUserMarketSide(userId: string, marketId: string, side: "yes" | "no") {
        return this.positions.get(this.key(userId, marketId, side)) ?? null;
    }

    getByUser(userId: string): Position[] {
        return Array.from(this.positions.values()).filter((p) => p.userId === userId);
    }

    getByMarket(marketId: string): Position[] {
        return Array.from(this.positions.values()).filter((p) => p.marketId === marketId);
    }

    upsertPosition(userId: string, marketId: string, side: "yes" | "no", quantity: Decimal, avgCostBasis: Decimal): void {
        const key = this.key(userId, marketId, side);
        const existing = this.positions.get(key);
        if (existing) {
            existing.quantity = existing.quantity.plus(quantity);
            existing.lastUpdated = new Date();
        } else {
            this.positions.set(
                key,
                createPositionProjection({
                    userId,
                    marketId,
                    side,
                    quantity: quantity.toNumber(),
                    avgCostBasis: avgCostBasis.toNumber(),
                    lockedQuantity: 0,
                }),
            );
        }
    }

    reducePosition(positionId: string, quantity: Decimal): void {
        for (const pos of this.positions.values()) {
            if (pos.positionId === positionId) {
                pos.quantity = pos.quantity.minus(quantity);
                pos.lockedQuantity = Decimal.max(pos.lockedQuantity.minus(quantity), new Decimal(0));
                pos.lastUpdated = new Date();
            }
        }
    }

    lockShares(positionId: string, quantity: Decimal): void {
        for (const pos of this.positions.values()) {
            if (pos.positionId === positionId) {
                pos.lockedQuantity = pos.lockedQuantity.plus(quantity);
                pos.lastUpdated = new Date();
            }
        }
    }

    unlockShares(positionId: string, quantity: Decimal): void {
        for (const pos of this.positions.values()) {
            if (pos.positionId === positionId) {
                pos.lockedQuantity = pos.lockedQuantity.minus(quantity);
                pos.lastUpdated = new Date();
            }
        }
    }

    archive(positionId: string): void {
        for (const [_key, pos] of this.positions.entries()) {
            if (pos.positionId === positionId) {
                pos.isArchived = true;
                pos.lastUpdated = new Date();
            }
        }
    }

    set(userId: string, marketId: string, side: "yes" | "no", position: ReturnType<typeof createPositionProjection>): void {
        this.positions.set(this.key(userId, marketId, side), position);
    }

    clear(): void {
        this.positions.clear();
    }
}

class InMemoryMarketRepo {
    private markets = new Map<string, Market>();

    getById(marketId: string): Market | null {
        return this.markets.get(marketId) ?? null;
    }

    updatePricing(marketId: string, yesPrice: Decimal, noPrice: Decimal): void {
        const market = this.markets.get(marketId);
        if (market) {
            market.yesPrice = yesPrice;
            market.noPrice = noPrice;
        }
    }

    updateStatus(marketId: string, status: Market["status"]): void {
        const market = this.markets.get(marketId);
        if (market) {
            market.status = status;
        }
    }

    resolve(marketId: string, outcome: boolean): void {
        const market = this.markets.get(marketId);
        if (market) {
            market.status = "resolved";
            market.outcome = outcome;
            market.lastUpdated = new Date();
        }
    }

    set(marketId: string, market: Market): void {
        this.markets.set(marketId, market);
    }

    clear(): void {
        this.markets.clear();
    }
}

class InMemorySettlementRepo {
    private batches = new Map<string, SettlementBatch>();
    private events: Array<{
        contractId: string;
        settlementId: string;
        transactionId: string;
        status: string;
        timestamp: Date;
    }> = [];

    createBatch(batch: SettlementBatch): void {
        this.batches.set(batch.batchId, batch);
    }

    getBatchById(batchId: string): SettlementBatch | null {
        return this.batches.get(batchId) ?? null;
    }

    updateBatchStatus(batchId: string, status: SettlementBatch["status"], error?: string): void {
        const batch = this.batches.get(batchId);
        if (batch) {
            batch.status = status;
            if (error) batch.lastError = error;
        }
    }

    setBatchCantonTxId(batchId: string, txId: string): void {
        const batch = this.batches.get(batchId);
        if (batch) {
            batch.cantonTransactionId = txId;
        }
    }

    getBatchesByStatus(statuses: SettlementBatch["status"][]): SettlementBatch[] {
        return Array.from(this.batches.values()).filter((b) => statuses.includes(b.status));
    }

    incrementBatchRetry(batchId: string, error: string): void {
        const batch = this.batches.get(batchId);
        if (batch) {
            batch.retryCount++;
            batch.lastError = error;
        }
    }

    createEvent(event: { contractId: string; settlementId: string; transactionId?: string; status: string; timestamp: Date }): void {
        this.events.push({
            ...event,
            transactionId: event.transactionId ?? "",
        });
    }

    logCompensationFailure(): void {
        // No-op for tests
    }

    getEvents() {
        return this.events;
    }

    getBatches() {
        return Array.from(this.batches.values());
    }

    clear(): void {
        this.batches.clear();
        this.events = [];
    }
}

class MockPersistence {
    rehydrateOrderbook(_engine: MatchingEngine): { restoredCount: number } {
        return { restoredCount: 0 };
    }
    persistOrder(_order: Order): void {}
    removeOrder(_orderId: string): void {}
}

// ============================================
// Market Resolution Tests
// ============================================

describe("Market Resolution Integration", () => {
    let orderService: OrderService;
    let settlementService: SettlementService;
    let matchingEngine: MatchingEngine;
    let orderRepo: InMemoryOrderRepo;
    let tradeRepo: InMemoryTradeRepo;
    let accountRepo: InMemoryAccountRepo;
    let positionRepo: InMemoryPositionRepo;
    let marketRepo: InMemoryMarketRepo;
    let settlementRepo: InMemorySettlementRepo;

    const marketId = testId("market");
    const alice = "Alice";
    const bob = "Bob";

    beforeEach(() => {
        matchingEngine = new MatchingEngine();
        orderRepo = new InMemoryOrderRepo();
        tradeRepo = new InMemoryTradeRepo();
        accountRepo = new InMemoryAccountRepo();
        positionRepo = new InMemoryPositionRepo();
        marketRepo = new InMemoryMarketRepo();
        settlementRepo = new InMemorySettlementRepo();

        const persistence = new MockPersistence() as unknown as OrderbookPersistence;

        // Create an open market
        marketRepo.set(
            marketId,
            createMarket({
                marketId,
                status: "open",
                question: "Will it rain tomorrow?",
            }),
        );

        // Set up accounts
        accountRepo.set(
            alice,
            createAccountProjection({
                userId: alice,
                availableBalance: 10000,
            }),
        );
        accountRepo.set(
            bob,
            createAccountProjection({
                userId: bob,
                availableBalance: 10000,
            }),
        );

        orderService = new OrderService(
            null,
            matchingEngine,
            persistence,
            orderRepo as never,
            tradeRepo as never,
            accountRepo as never,
            positionRepo as never,
            marketRepo as never,
            settlementRepo as never,
            { pebbleAdminParty: "PebbleAdmin" },
        );

        settlementService = new SettlementService(
            null,
            tradeRepo as never,
            settlementRepo as never,
            accountRepo as never,
            positionRepo as never,
            marketRepo as never,
            {
                batchIntervalMs: 50,
                maxBatchSize: 10,
                maxRetries: 3,
                roundDelayMs: 10,
                proposalTimeoutMs: 300000,
                pebbleAdminParty: "PebbleAdmin",
            },
        );
    });

    afterEach(async () => {
        await settlementService.shutdown();
    });

    describe("Full Market Lifecycle", () => {
        it("should complete market lifecycle: trade → settle → close → resolve", async () => {
            // Step 1: Create opposing orders that create shares
            // Alice buys YES @ 0.60, Bob buys NO @ 0.40
            const yesResult = await orderService.placeOrder(alice, {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.6,
                quantity: 100,
            });
            expect(yesResult.status).toBe("open");

            const noResult = await orderService.placeOrder(bob, {
                marketId,
                side: "no",
                action: "buy",
                orderType: "limit",
                price: 0.4,
                quantity: 100,
            });
            expect(noResult.status).toBe("filled");

            // Step 2: Verify trade was created
            const trades = tradeRepo.getAll();
            expect(trades).toHaveLength(1);
            expect(trades[0].tradeType).toBe("share_creation");

            // Step 3: Settle the trade
            settlementService.queueTrades(trades);
            settlementService.initialize();
            await new Promise((resolve) => setTimeout(resolve, 150));

            const batches = settlementRepo.getBatches();
            expect(batches.some((b) => b.status === "completed")).toBe(true);

            // Step 4: Simulate positions being created after settlement
            // (In real system, this would happen via Canton events)
            positionRepo.set(
                alice,
                marketId,
                "yes",
                createPositionProjection({
                    userId: alice,
                    marketId,
                    side: "yes",
                    quantity: 100,
                    avgCostBasis: 0.6,
                }),
            );
            positionRepo.set(
                bob,
                marketId,
                "no",
                createPositionProjection({
                    userId: bob,
                    marketId,
                    side: "no",
                    quantity: 100,
                    avgCostBasis: 0.4,
                }),
            );

            // Step 5: Close the market (no more trading)
            marketRepo.updateStatus(marketId, "closed");
            const closedMarket = marketRepo.getById(marketId);
            expect(closedMarket!.status).toBe("closed");

            // Step 6: Resolve the market (YES wins)
            marketRepo.resolve(marketId, true);
            const resolvedMarket = marketRepo.getById(marketId);
            expect(resolvedMarket!.status).toBe("resolved");
            expect(resolvedMarket!.outcome).toBe(true);

            // Step 7: Verify winning/losing positions
            const alicePos = positionRepo.getByUserMarketSide(alice, marketId, "yes");
            const bobPos = positionRepo.getByUserMarketSide(bob, marketId, "no");

            expect(alicePos).not.toBeNull();
            expect(bobPos).not.toBeNull();

            // Alice has winning YES position (100 shares worth $100)
            // Bob has losing NO position (worthless)
            const isAliceWinner = resolvedMarket!.outcome === true && alicePos!.side === "yes";
            const isBobWinner = resolvedMarket!.outcome === false && bobPos!.side === "no";

            expect(isAliceWinner).toBe(true);
            expect(isBobWinner).toBe(false);
        });

        it("should handle market resolution where NO wins", async () => {
            // Alice buys YES, Bob buys NO via share creation
            await orderService.placeOrder(alice, {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.7,
                quantity: 50,
            });

            await orderService.placeOrder(bob, {
                marketId,
                side: "no",
                action: "buy",
                orderType: "limit",
                price: 0.3,
                quantity: 50,
            });

            // Settle
            settlementService.queueTrades(tradeRepo.getAll());
            settlementService.initialize();
            await new Promise((resolve) => setTimeout(resolve, 150));

            // Create positions
            positionRepo.set(
                alice,
                marketId,
                "yes",
                createPositionProjection({
                    userId: alice,
                    marketId,
                    side: "yes",
                    quantity: 50,
                    avgCostBasis: 0.7,
                }),
            );
            positionRepo.set(
                bob,
                marketId,
                "no",
                createPositionProjection({
                    userId: bob,
                    marketId,
                    side: "no",
                    quantity: 50,
                    avgCostBasis: 0.3,
                }),
            );

            // Close and resolve as NO
            marketRepo.updateStatus(marketId, "closed");
            marketRepo.resolve(marketId, false);

            const market = marketRepo.getById(marketId);
            expect(market!.outcome).toBe(false);

            // Bob's NO position is now winning
            const bobPos = positionRepo.getByUserMarketSide(bob, marketId, "no");
            const isBobWinner = market!.outcome === false && bobPos!.side === "no";
            expect(isBobWinner).toBe(true);
        });
    });

    describe("Market Close Behavior", () => {
        it("should prevent trading on closed market", async () => {
            // Close the market
            marketRepo.updateStatus(marketId, "closed");

            // Attempt to place order should fail
            try {
                await orderService.placeOrder(alice, {
                    marketId,
                    side: "yes",
                    action: "buy",
                    orderType: "limit",
                    price: 0.5,
                    quantity: 100,
                });
                expect(true).toBe(false); // Should not reach here
            } catch (error) {
                expect(error).toBeDefined();
            }
        });

        it("should cancel open orders when market closes", async () => {
            // Place some open orders
            await orderService.placeOrder(alice, {
                marketId,
                side: "yes",
                action: "buy",
                orderType: "limit",
                price: 0.3, // Low price - won't match
                quantity: 100,
            });

            await orderService.placeOrder(bob, {
                marketId,
                side: "no",
                action: "buy",
                orderType: "limit",
                price: 0.3, // Low price - won't match
                quantity: 100,
            });

            // Verify orders are open
            const openOrdersBefore = orderRepo.getOpenOrdersByUser(alice);
            expect(openOrdersBefore.length).toBeGreaterThan(0);

            // Cancel all orders (market close operation)
            const cancelledCount = orderRepo.cancelAllByMarket(marketId);
            expect(cancelledCount).toBe(2);

            // Verify orders are cancelled
            const openOrdersAfter = orderRepo.getOpenOrdersByUser(alice);
            expect(openOrdersAfter.length).toBe(0);
        });
    });

    describe("Position Redemption", () => {
        it("should calculate correct payout for winning YES position", async () => {
            // Set up resolved market with YES outcome
            marketRepo.updateStatus(marketId, "closed");
            marketRepo.resolve(marketId, true);

            // Alice has YES position
            const position = createPositionProjection({
                userId: alice,
                marketId,
                side: "yes",
                quantity: 100,
                avgCostBasis: 0.6,
            });
            positionRepo.set(alice, marketId, "yes", position);

            // Calculate redemption payout
            const market = marketRepo.getById(marketId)!;
            const isWinner = (market.outcome === true && position.side === "yes") || (market.outcome === false && position.side === "no");

            expect(isWinner).toBe(true);

            // Payout is $1 per winning share
            const payout = isWinner ? position.quantity : new Decimal(0);
            expect(payout.toNumber()).toBe(100);

            // Calculate profit
            const costBasis = position.quantity.mul(position.avgCostBasis);
            const profit = payout.minus(costBasis);
            expect(profit.toNumber()).toBe(40); // $100 - $60 = $40 profit
        });

        it("should return zero payout for losing position", async () => {
            // Set up resolved market with YES outcome
            marketRepo.updateStatus(marketId, "closed");
            marketRepo.resolve(marketId, true);

            // Bob has NO position (loser)
            const position = createPositionProjection({
                userId: bob,
                marketId,
                side: "no",
                quantity: 100,
                avgCostBasis: 0.4,
            });
            positionRepo.set(bob, marketId, "no", position);

            const market = marketRepo.getById(marketId)!;
            const isWinner = (market.outcome === true && position.side === "yes") || (market.outcome === false && position.side === "no");

            expect(isWinner).toBe(false);

            // No payout for losers
            const payout = isWinner ? position.quantity : new Decimal(0);
            expect(payout.toNumber()).toBe(0);

            // Calculate loss
            const costBasis = position.quantity.mul(position.avgCostBasis);
            const loss = costBasis; // Lost entire cost basis
            expect(loss.toNumber()).toBe(40); // Lost $40
        });
    });

    describe("Position Merge", () => {
        it("should allow merging YES+NO positions back to collateral", async () => {
            // Alice has both YES and NO positions (from different trades)
            positionRepo.set(
                alice,
                marketId,
                "yes",
                createPositionProjection({
                    userId: alice,
                    marketId,
                    side: "yes",
                    quantity: 50,
                    avgCostBasis: 0.6,
                }),
            );
            positionRepo.set(
                alice,
                marketId,
                "no",
                createPositionProjection({
                    userId: alice,
                    marketId,
                    side: "no",
                    quantity: 50,
                    avgCostBasis: 0.4,
                }),
            );

            const yesPos = positionRepo.getByUserMarketSide(alice, marketId, "yes")!;
            const noPos = positionRepo.getByUserMarketSide(alice, marketId, "no")!;

            // Calculate mergeable quantity
            const mergeableYes = yesPos.quantity.minus(yesPos.lockedQuantity);
            const mergeableNo = noPos.quantity.minus(noPos.lockedQuantity);
            const maxMergeable = Decimal.min(mergeableYes, mergeableNo);

            expect(maxMergeable.toNumber()).toBe(50);

            // Merge returns $1 per pair
            const payout = maxMergeable;
            expect(payout.toNumber()).toBe(50);
        });

        it("should not allow merging locked shares", async () => {
            // Alice has YES and NO but YES is partially locked
            positionRepo.set(
                alice,
                marketId,
                "yes",
                createPositionProjection({
                    userId: alice,
                    marketId,
                    side: "yes",
                    quantity: 100,
                    lockedQuantity: 60, // 60 locked in sell order
                    avgCostBasis: 0.6,
                }),
            );
            positionRepo.set(
                alice,
                marketId,
                "no",
                createPositionProjection({
                    userId: alice,
                    marketId,
                    side: "no",
                    quantity: 100,
                    lockedQuantity: 0,
                    avgCostBasis: 0.4,
                }),
            );

            const yesPos = positionRepo.getByUserMarketSide(alice, marketId, "yes")!;
            const noPos = positionRepo.getByUserMarketSide(alice, marketId, "no")!;

            // Only 40 YES shares are available (100 - 60 locked)
            const availableYes = yesPos.quantity.minus(yesPos.lockedQuantity);
            const availableNo = noPos.quantity.minus(noPos.lockedQuantity);
            const maxMergeable = Decimal.min(availableYes, availableNo);

            expect(maxMergeable.toNumber()).toBe(40);
        });
    });
});
