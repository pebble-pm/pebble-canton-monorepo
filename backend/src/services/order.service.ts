/**
 * Order Service
 *
 * Handles order placement with the saga pattern for compensation on failures.
 * Integrates Canton fund/position locking with off-chain matching engine.
 *
 * Flow:
 * 1. Validate order (price, quantity, market status, balances)
 * 2. Check idempotency
 * 3. Lock funds/position on Canton
 * 4. Save order to database
 * 5. Process through matching engine
 * 6. Queue trades for settlement
 * 7. Update order status
 * 8. Handle excess lock refunds
 */

import Decimal from "decimal.js";
import type { CantonLedgerClient } from "../canton/client";
import { exerciseCommand, generateCommandId } from "../canton/client";
import { Templates, Choices } from "../canton/templates";
import { MatchingEngine, OrderbookPersistence } from "../matching";
import type { MatchResult } from "../matching";
import type { Order, PlaceOrderRequest, PlaceOrderResponse, TradeExecution, TradingAccount, Position, Market } from "../types";
import type { OrderRepository } from "../db/repositories/order.repository";
import type { TradeRepository } from "../db/repositories/trade.repository";
import type { AccountRepository } from "../db/repositories/account.repository";
import type { PositionRepository } from "../db/repositories/position.repository";
import type { MarketRepository } from "../db/repositories/market.repository";
import type { SettlementRepository } from "../db/repositories/settlement.repository";
import { wsManager } from "../api/websocket/ws-manager";
import { logWsBroadcast, logWsUserMessage } from "../utils/logger";

// ============================================
// Types
// ============================================

/** Saga state for tracking compensation */
interface OrderSagaState {
    fundsLocked: boolean;
    positionLocked: boolean;
    lockTxId?: string;
    newAccountCid?: string;
    newPositionCid?: string;
    orderSaved: boolean;
    orderAddedToBook: boolean;
}

/** Validation result */
interface ValidationResult {
    valid: boolean;
    error?: string;
    code?: string;
    requiredFunds: Decimal;
    positionToLock?: Position;
    account?: TradingAccount;
    market?: Market;
}

/** Order service configuration */
export interface OrderServiceConfig {
    pebbleAdminParty: string;
    maxQuantity?: number; // Default: 1,000,000
    maxPendingOrdersPerUser?: number; // Default: 100
}

// ============================================
// Order Service
// ============================================

export class OrderService {
    private readonly maxQuantity: number;
    private readonly maxPendingOrdersPerUser: number;

    constructor(
        private cantonClient: CantonLedgerClient | null,
        private matchingEngine: MatchingEngine,
        private persistence: OrderbookPersistence,
        private orderRepo: OrderRepository,
        private tradeRepo: TradeRepository,
        private accountRepo: AccountRepository,
        private positionRepo: PositionRepository,
        private marketRepo: MarketRepository,
        private _settlementRepo: SettlementRepository, // Used in Phase 5: Settlement Service
        private config: OrderServiceConfig,
    ) {
        this.maxQuantity = config.maxQuantity ?? 1_000_000;
        this.maxPendingOrdersPerUser = config.maxPendingOrdersPerUser ?? 100;
    }

    // ============================================
    // Public API
    // ============================================

    /**
     * Get the settlement repository for use by SettlementService
     * This enables Phase 5 settlement integration
     */
    getSettlementRepo(): SettlementRepository {
        return this._settlementRepo;
    }

    /**
     * Place a new order
     *
     * @param userId The user's party ID
     * @param request Order parameters
     * @param idempotencyKey Optional key for duplicate prevention
     * @returns Order result with fills and status
     */
    async placeOrder(userId: string, request: PlaceOrderRequest, idempotencyKey?: string): Promise<PlaceOrderResponse> {
        // Check idempotency first
        if (idempotencyKey) {
            const existing = this.checkIdempotency(userId, idempotencyKey);
            if (existing) {
                return existing;
            }
        }

        // Validate the order
        const validation = await this.validateOrder(userId, request);
        if (!validation.valid) {
            throw new OrderValidationError(validation.error ?? "Invalid order", validation.code ?? "VALIDATION_FAILED");
        }

        const orderId = crypto.randomUUID();
        const now = new Date();

        // Initialize saga state for compensation tracking
        const sagaState: OrderSagaState = {
            fundsLocked: false,
            positionLocked: false,
            orderSaved: false,
            orderAddedToBook: false,
        };

        try {
            // Step 1: Lock funds/position on Canton BEFORE matching
            if (request.action === "buy" && validation.requiredFunds.gt(0)) {
                const lockResult = await this.lockFundsOnCanton(
                    userId,
                    orderId,
                    validation.requiredFunds,
                    validation.account!.accountContractId!,
                );
                sagaState.fundsLocked = true;
                sagaState.lockTxId = lockResult.txId;
                sagaState.newAccountCid = lockResult.newCid;

                // Update local cache with new balances
                this.accountRepo.lockFunds(userId, validation.requiredFunds);

                // Update contract ID in database (Canton creates new contract after each exercise)
                if (lockResult.newCid && lockResult.newCid !== validation.account!.accountContractId) {
                    this.accountRepo.updateAccountContractId(userId, lockResult.newCid);
                }
            }

            if (request.action === "sell" && validation.positionToLock) {
                const lockResult = await this.lockPositionOnCanton(
                    userId,
                    orderId,
                    new Decimal(request.quantity),
                    validation.positionToLock.positionId,
                );
                sagaState.positionLocked = true;
                sagaState.newPositionCid = lockResult.newCid;

                // Update local cache
                this.positionRepo.lockShares(validation.positionToLock.positionId, new Decimal(request.quantity));
            }

            // Step 2: Create and save order
            const order: Order = {
                orderId,
                marketId: request.marketId,
                userId,
                side: request.side,
                action: request.action,
                orderType: request.orderType,
                price: new Decimal(request.price ?? 0),
                quantity: new Decimal(request.quantity),
                filledQuantity: new Decimal(0),
                status: "pending",
                lockedAmount: validation.requiredFunds,
                cantonLockTxId: sagaState.lockTxId,
                idempotencyKey,
                createdAt: now,
                updatedAt: now,
            };

            // Save to database
            this.orderRepo.create(order);
            sagaState.orderSaved = true;

            // Step 3: Process through matching engine
            const matchResult = this.matchingEngine.processOrder(order);
            sagaState.orderAddedToBook = matchResult.remainingOrder !== null;

            // Step 4: Persist trades and queue for settlement
            for (const trade of matchResult.trades) {
                this.tradeRepo.create(trade);
                // Note: SettlementService will handle actual Canton settlement
            }

            // Step 5: Update order status
            this.orderRepo.updateFilled(orderId, matchResult.filledQuantity, matchResult.orderStatus);

            // Step 6: Handle excess lock refund for market orders
            let actualLockedAmount = validation.requiredFunds;
            if (request.action === "buy" && request.orderType === "market" && sagaState.fundsLocked) {
                actualLockedAmount = await this.handleMarketOrderExcessLock(
                    userId,
                    orderId,
                    validation.requiredFunds,
                    matchResult,
                    sagaState.newAccountCid,
                );
            }

            // Step 7: Unlock unfilled position for sell orders
            if (request.action === "sell" && sagaState.positionLocked) {
                await this.handleSellOrderUnfilledPosition(
                    userId,
                    orderId,
                    request,
                    matchResult,
                    validation.positionToLock!,
                    sagaState.newPositionCid,
                );
            }

            // Update market pricing with last trade
            if (matchResult.trades.length > 0) {
                const lastTrade = matchResult.trades[matchResult.trades.length - 1];
                const volume = matchResult.trades.reduce((sum, t) => sum.plus(t.quantity.mul(t.price)), new Decimal(0));
                this.marketRepo.updatePricing(request.marketId, lastTrade.price, volume);
            }

            // Build response
            const tradeExecutions: TradeExecution[] = matchResult.trades.map((t) => ({
                tradeId: t.tradeId,
                price: t.price,
                quantity: t.quantity,
                counterpartyOrderId: t.buyerOrderId === orderId ? t.sellerOrderId : t.buyerOrderId,
            }));

            // WebSocket broadcasts
            this.broadcastOrderPlaced(order, matchResult, tradeExecutions);

            return {
                orderId,
                status: matchResult.orderStatus,
                filledQuantity: matchResult.filledQuantity,
                remainingQuantity: order.quantity.minus(matchResult.filledQuantity),
                trades: tradeExecutions,
                lockedAmount: actualLockedAmount,
                idempotencyKey,
            };
        } catch (error) {
            // Execute compensation on any failure
            console.error(`Order ${orderId} failed, executing compensation:`, error);
            await this.executeCompensation(orderId, userId, request, sagaState, validation);
            throw error;
        }
    }

    /**
     * Cancel an open order
     */
    async cancelOrder(userId: string, orderId: string): Promise<Order> {
        const order = this.orderRepo.getById(orderId);

        if (!order) {
            throw new OrderNotFoundError(orderId);
        }

        if (order.userId !== userId) {
            throw new OrderValidationError("Cannot cancel another user's order", "UNAUTHORIZED");
        }

        if (order.status === "filled" || order.status === "cancelled") {
            throw new OrderValidationError(`Cannot cancel order with status ${order.status}`, "INVALID_STATUS");
        }

        // Calculate remaining locked amount/quantity
        const remainingQuantity = order.quantity.minus(order.filledQuantity);

        // Unlock funds or position
        if (order.action === "buy" && order.lockedAmount.gt(0)) {
            const remainingLocked = order.lockedAmount.mul(remainingQuantity).div(order.quantity);

            if (remainingLocked.gt(0)) {
                const account = this.accountRepo.getById(userId);
                if (account?.accountContractId) {
                    try {
                        const newCid = await this.unlockFundsOnCanton(orderId, remainingLocked, account.accountContractId);
                        this.accountRepo.unlockFunds(userId, remainingLocked);
                        // Update contract ID in database (Canton creates new contract after each exercise)
                        if (newCid && newCid !== account.accountContractId) {
                            this.accountRepo.updateAccountContractId(userId, newCid);
                        }
                    } catch (err) {
                        console.error(`Failed to unlock funds for cancelled order ${orderId}:`, err);
                        // Log for manual reconciliation but don't block cancellation
                    }
                }
            }
        }

        if (order.action === "sell" && remainingQuantity.gt(0)) {
            const position = this.positionRepo.getByUserMarketSide(userId, order.marketId, order.side);
            if (position) {
                try {
                    await this.unlockPositionOnCanton(orderId, remainingQuantity, position.positionId);
                    this.positionRepo.unlockShares(position.positionId, remainingQuantity);
                } catch (err) {
                    console.error(`Failed to unlock position for cancelled order ${orderId}:`, err);
                }
            }
        }

        // Remove from matching engine
        this.matchingEngine.cancelOrder(orderId, order.marketId);

        // Update database
        this.orderRepo.updateStatus(orderId, "cancelled");

        const cancelledOrder: Order = {
            ...order,
            status: "cancelled",
            updatedAt: new Date(),
        };

        // WebSocket broadcasts
        this.broadcastOrderCancelled(cancelledOrder);

        return cancelledOrder;
    }

    /**
     * Get orders for a user
     */
    getOrdersByUser(userId: string, marketId?: string): Order[] {
        if (marketId) {
            return this.orderRepo.getByUser(userId).filter((o) => o.marketId === marketId);
        }
        return this.orderRepo.getByUser(userId);
    }

    /**
     * Get open orders for a user
     */
    getOpenOrdersByUser(userId: string, marketId?: string): Order[] {
        return this.orderRepo.getOpenOrdersByUser(userId, marketId);
    }

    /**
     * Get order by ID
     */
    getOrderById(orderId: string): Order | null {
        return this.orderRepo.getById(orderId);
    }

    /**
     * Initialize the order service (rehydrate orderbook)
     */
    initialize(): void {
        console.log("[OrderService] Initializing...");
        const result = this.persistence.rehydrateOrderbook(this.matchingEngine);
        console.log(`[OrderService] Initialized with ${result.restoredCount} orders`);
    }

    // ============================================
    // Private Methods
    // ============================================

    /**
     * Validate an order before processing
     */
    private async validateOrder(userId: string, request: PlaceOrderRequest): Promise<ValidationResult> {
        // Price validation
        if (request.orderType === "limit") {
            if (request.price === undefined || request.price < 0.01 || request.price > 0.99) {
                return {
                    valid: false,
                    error: "Price must be between 0.01 and 0.99",
                    code: "INVALID_PRICE",
                    requiredFunds: new Decimal(0),
                };
            }
        }

        // Quantity validation
        if (request.quantity <= 0 || request.quantity > this.maxQuantity) {
            return {
                valid: false,
                error: `Quantity must be between 0 and ${this.maxQuantity}`,
                code: "INVALID_QUANTITY",
                requiredFunds: new Decimal(0),
            };
        }

        // Market validation
        const market = this.marketRepo.getById(request.marketId);
        if (!market) {
            return {
                valid: false,
                error: "Market not found",
                code: "MARKET_NOT_FOUND",
                requiredFunds: new Decimal(0),
            };
        }

        if (market.status !== "open") {
            return {
                valid: false,
                error: "Market is not open for trading",
                code: "MARKET_NOT_OPEN",
                requiredFunds: new Decimal(0),
            };
        }

        // Verify market status on-chain if Canton is available
        if (this.cantonClient && market.contractId) {
            try {
                const isOpen = await this.verifyMarketOnChain(market.contractId, market.marketId);
                if (!isOpen) {
                    // Update local cache
                    this.marketRepo.updateStatus(market.marketId, "closed");
                    return {
                        valid: false,
                        error: "Market is not open for trading (on-chain)",
                        code: "MARKET_NOT_OPEN_ONCHAIN",
                        requiredFunds: new Decimal(0),
                    };
                }
            } catch (err) {
                // Fail-closed: reject orders when market status cannot be verified
                console.error("Failed to verify market on-chain:", err);
                return {
                    valid: false,
                    error: "Unable to verify market status. Please try again.",
                    code: "MARKET_VERIFICATION_FAILED",
                    requiredFunds: new Decimal(0),
                };
            }
        }

        // Account validation
        const account = this.accountRepo.getById(userId);
        if (!account) {
            return {
                valid: false,
                error: "Account not found",
                code: "ACCOUNT_NOT_FOUND",
                requiredFunds: new Decimal(0),
            };
        }

        // Check pending orders limit
        const openOrders = this.orderRepo.getOpenOrdersByUser(userId);
        if (openOrders.length >= this.maxPendingOrdersPerUser) {
            return {
                valid: false,
                error: `Maximum pending orders (${this.maxPendingOrdersPerUser}) reached`,
                code: "MAX_PENDING_ORDERS",
                requiredFunds: new Decimal(0),
            };
        }

        // Calculate required funds and validate balance/position
        let requiredFunds = new Decimal(0);
        let positionToLock: Position | undefined;

        if (request.action === "buy") {
            // For market orders, use max price (0.99) to ensure sufficient lock
            const price = new Decimal(request.price ?? 0.99);
            requiredFunds = price.mul(request.quantity);

            if (account.availableBalance.lt(requiredFunds)) {
                return {
                    valid: false,
                    error: "Insufficient balance",
                    code: "INSUFFICIENT_BALANCE",
                    requiredFunds,
                };
            }
        } else {
            // Selling: check position exists with sufficient available quantity
            const position = this.positionRepo.getByUserMarketSide(userId, request.marketId, request.side);

            if (!position) {
                return {
                    valid: false,
                    error: "No position to sell",
                    code: "NO_POSITION",
                    requiredFunds,
                };
            }

            const availableQuantity = position.quantity.minus(position.lockedQuantity);
            if (availableQuantity.lt(request.quantity)) {
                return {
                    valid: false,
                    error: `Insufficient available position. Available: ${availableQuantity}, Requested: ${request.quantity}`,
                    code: "INSUFFICIENT_POSITION",
                    requiredFunds,
                };
            }

            positionToLock = position;
        }

        return {
            valid: true,
            requiredFunds,
            positionToLock,
            account,
            market,
        };
    }

    /**
     * Check if an order with the same idempotency key exists
     */
    private checkIdempotency(userId: string, idempotencyKey: string): PlaceOrderResponse | null {
        const existing = this.orderRepo.getByIdempotencyKey(userId, idempotencyKey);
        if (!existing) {
            return null;
        }

        console.log(`[OrderService] Returning cached order for idempotency key: ${idempotencyKey}`);

        return {
            orderId: existing.orderId,
            status: existing.status,
            filledQuantity: existing.filledQuantity,
            remainingQuantity: existing.quantity.minus(existing.filledQuantity),
            trades: [], // Don't replay trades for idempotent response
            lockedAmount: existing.lockedAmount,
            idempotencyKey,
        };
    }

    /**
     * Lock funds on Canton
     * Queries Canton for fresh contract ID before locking to avoid stale contract errors
     */
    private async lockFundsOnCanton(
        userId: string,
        orderId: string,
        amount: Decimal,
        accountCid: string,
    ): Promise<{ txId: string; newCid: string }> {
        if (!this.cantonClient) {
            // Offline mode - skip Canton lock
            return { txId: "", newCid: accountCid };
        }

        // Query Canton for fresh contract ID (may have changed due to settlement)
        const freshCid = await this.getFreshAccountContractId(userId, accountCid);

        const result = await this.cantonClient.submitCommand({
            userId: "pebble-order-service",
            commandId: generateCommandId(`lock-funds-${orderId}`),
            actAs: [this.config.pebbleAdminParty],
            readAs: [this.config.pebbleAdminParty],
            commands: [
                exerciseCommand(Templates.TradingAccount, freshCid, Choices.TradingAccount.LockFunds, {
                    amount: amount.toString(),
                    orderId,
                }),
            ],
        });

        return {
            txId: result.transactionId,
            newCid: result.contractId ?? freshCid,
        };
    }

    /**
     * Query Canton for the fresh TradingAccount contract ID
     * Updates the database if a different contract ID is found
     */
    private async getFreshAccountContractId(userId: string, cachedCid: string): Promise<string> {
        if (!this.cantonClient) {
            return cachedCid;
        }

        try {
            const contracts = await this.cantonClient.getActiveContracts<{
                owner: string;
                availableBalance: string;
                lockedBalance: string;
            }>({
                templateId: Templates.TradingAccount,
                party: this.config.pebbleAdminParty,
            });

            const userContract = contracts.find((c) => c.payload.owner === userId);
            if (userContract) {
                // Update database if contract ID changed
                if (userContract.contractId !== cachedCid) {
                    console.log(
                        `[OrderService] Updating stale contract ID for ${userId.slice(0, 20)}...: ${cachedCid.slice(0, 20)}... -> ${userContract.contractId.slice(0, 20)}...`,
                    );
                    this.accountRepo.updateAccountContractId(userId, userContract.contractId);
                }
                return userContract.contractId;
            }
        } catch (error) {
            console.warn(`[OrderService] Failed to query Canton for fresh contract ID, using cached: ${error}`);
        }

        return cachedCid;
    }

    /**
     * Lock position on Canton
     */
    private async lockPositionOnCanton(
        _userId: string, // Reserved for Canton command actAs
        orderId: string,
        quantity: Decimal,
        positionCid: string,
    ): Promise<{ txId: string; newCid: string }> {
        if (!this.cantonClient) {
            return { txId: "", newCid: positionCid };
        }

        const result = await this.cantonClient.submitCommand({
            userId: "pebble-order-service",
            commandId: generateCommandId(`lock-position-${orderId}`),
            actAs: [this.config.pebbleAdminParty],
            readAs: [this.config.pebbleAdminParty],
            commands: [
                exerciseCommand(Templates.Position, positionCid, Choices.Position.LockPosition, {
                    lockQuantity: quantity.toString(),
                    orderId,
                }),
            ],
        });

        return {
            txId: result.transactionId,
            newCid: result.contractId ?? positionCid,
        };
    }

    /**
     * Unlock funds on Canton
     * Returns the new contract ID after the exercise
     */
    private async unlockFundsOnCanton(orderId: string, amount: Decimal, accountCid: string): Promise<string | undefined> {
        if (!this.cantonClient) {
            return undefined;
        }

        const result = await this.cantonClient.submitCommand({
            userId: "pebble-order-service",
            commandId: generateCommandId(`unlock-funds-${orderId}`),
            actAs: [this.config.pebbleAdminParty],
            readAs: [this.config.pebbleAdminParty],
            commands: [
                exerciseCommand(Templates.TradingAccount, accountCid, Choices.TradingAccount.UnlockFunds, {
                    amount: amount.toString(),
                    orderId,
                }),
            ],
        });

        return result.contractId;
    }

    /**
     * Unlock position on Canton
     */
    private async unlockPositionOnCanton(orderId: string, quantity: Decimal, positionCid: string): Promise<void> {
        if (!this.cantonClient) {
            return;
        }

        await this.cantonClient.submitCommand({
            userId: "pebble-order-service",
            commandId: generateCommandId(`unlock-position-${orderId}`),
            actAs: [this.config.pebbleAdminParty],
            readAs: [this.config.pebbleAdminParty],
            commands: [
                exerciseCommand(Templates.Position, positionCid, Choices.Position.UnlockPosition, {
                    unlockQuantity: quantity.toString(),
                    orderId,
                }),
            ],
        });
    }

    /**
     * Verify market is open on Canton
     */
    private async verifyMarketOnChain(contractId: string, marketId: string): Promise<boolean> {
        if (!this.cantonClient) {
            return true; // Assume open if offline
        }

        try {
            const contract = await this.cantonClient.getContract<{
                status: string;
                marketId: string;
            }>(contractId, this.config.pebbleAdminParty);

            if (!contract) {
                return false;
            }

            return contract.payload.marketId === marketId && contract.payload.status === "Open";
        } catch {
            return false;
        }
    }

    /**
     * Handle excess lock refund for market orders
     */
    private async handleMarketOrderExcessLock(
        userId: string,
        orderId: string,
        originalLock: Decimal,
        matchResult: MatchResult,
        accountCid?: string,
    ): Promise<Decimal> {
        // Calculate actual cost of filled trades
        const actualCost = matchResult.trades.reduce((sum, t) => sum.plus(t.quantity.mul(t.price)), new Decimal(0));

        const excessLock = originalLock.minus(actualCost);

        // Skip if excess is negligible
        if (excessLock.lt(0.0001)) {
            return actualCost;
        }

        const account = this.accountRepo.getById(userId);
        const cid = accountCid ?? account?.accountContractId;

        if (cid) {
            try {
                const newCid = await this.unlockFundsOnCanton(orderId, excessLock, cid);
                this.accountRepo.unlockFunds(userId, excessLock);
                // Update contract ID in database (Canton creates new contract after each exercise)
                if (newCid && newCid !== cid) {
                    this.accountRepo.updateAccountContractId(userId, newCid);
                }
            } catch (e) {
                console.error(`Failed to unlock excess funds for market order ${orderId}:`, e);
                // Non-fatal: funds remain locked but will be unlocked during settlement
                return originalLock;
            }
        }

        return actualCost;
    }

    /**
     * Handle unlocking unfilled position for sell orders
     */
    private async handleSellOrderUnfilledPosition(
        _userId: string, // Reserved for Canton command actAs
        orderId: string,
        request: PlaceOrderRequest,
        matchResult: MatchResult,
        position: Position,
        positionCid?: string,
    ): Promise<void> {
        const unfilledQuantity = new Decimal(request.quantity).minus(matchResult.filledQuantity);

        // Only unlock if order is complete (filled, rejected, or cancelled)
        if (unfilledQuantity.gt(0) && matchResult.orderStatus !== "open" && matchResult.orderStatus !== "partial") {
            const cid = positionCid ?? position.positionId;
            try {
                await this.unlockPositionOnCanton(orderId, unfilledQuantity, cid);
                this.positionRepo.unlockShares(position.positionId, unfilledQuantity);
            } catch (e) {
                console.error(`Failed to unlock unfilled position for order ${orderId}:`, e);
            }
        }
    }

    /**
     * Execute compensation for failed order
     */
    private async executeCompensation(
        orderId: string,
        userId: string,
        request: PlaceOrderRequest,
        sagaState: OrderSagaState,
        validation: ValidationResult,
    ): Promise<void> {
        // Remove from matching engine first
        if (sagaState.orderAddedToBook) {
            try {
                this.matchingEngine.cancelOrder(orderId, request.marketId);
            } catch (e) {
                console.error(`Compensation: Failed to remove order from book:`, e);
            }
        }

        // Update order status to rejected
        if (sagaState.orderSaved) {
            try {
                this.orderRepo.updateStatus(orderId, "rejected");
            } catch (e) {
                console.error(`Compensation: Failed to update order status:`, e);
            }
        }

        // Unlock position
        if (sagaState.positionLocked && validation.positionToLock) {
            try {
                await this.unlockPositionOnCanton(
                    orderId,
                    new Decimal(request.quantity),
                    sagaState.newPositionCid ?? validation.positionToLock.positionId,
                );
                this.positionRepo.unlockShares(validation.positionToLock.positionId, new Decimal(request.quantity));
            } catch (e) {
                console.error(`Compensation: Failed to unlock position:`, e);
                // Log for manual reconciliation
                this.logCompensationFailure(orderId, userId, "position_unlock", e);
            }
        }

        // Unlock funds
        if (sagaState.fundsLocked && validation.account) {
            try {
                const currentCid = sagaState.newAccountCid ?? validation.account.accountContractId!;
                const newCid = await this.unlockFundsOnCanton(orderId, validation.requiredFunds, currentCid);
                this.accountRepo.unlockFunds(userId, validation.requiredFunds);
                // Update contract ID in database (Canton creates new contract after each exercise)
                if (newCid && newCid !== currentCid) {
                    this.accountRepo.updateAccountContractId(userId, newCid);
                }
            } catch (e) {
                console.error(`Compensation: Failed to unlock funds:`, e);
                // Log for manual reconciliation
                this.logCompensationFailure(orderId, userId, "funds_unlock", e);
            }
        }
    }

    /**
     * Log compensation failure for manual intervention
     */
    private logCompensationFailure(orderId: string, userId: string, type: string, error: unknown): void {
        console.error(`[COMPENSATION FAILURE] Order: ${orderId}, User: ${userId}, Type: ${type}`, error);
        // TODO: Store in compensation_failures table for manual review
        // this.settlementRepo.logCompensationFailure(...)
    }

    // ============================================
    // WebSocket Broadcasts
    // ============================================

    /**
     * Broadcast order placed events via WebSocket
     */
    private broadcastOrderPlaced(order: Order, matchResult: MatchResult, tradeExecutions: TradeExecution[]): void {
        const orderData = {
            orderId: order.orderId,
            marketId: order.marketId,
            side: order.side,
            action: order.action,
            price: order.price.toString(),
            quantity: order.quantity.toString(),
            filledQuantity: matchResult.filledQuantity.toString(),
            status: matchResult.orderStatus,
        };

        // 1. Notify the order owner
        wsManager.sendToUser(order.userId, "orders", "order:created", orderData);
        logWsUserMessage(order.userId, "orders", "order:created", { orderId: order.orderId });

        // 2. Broadcast orderbook update to market subscribers
        const orderbookChannel = `orderbook:${order.marketId}` as const;
        wsManager.broadcast(orderbookChannel, "orderbook:updated", {
            marketId: order.marketId,
            side: order.side,
            type: matchResult.remainingOrder ? "add" : "fill",
            price: order.price.toString(),
            quantity: matchResult.remainingOrder?.quantity.toString() ?? "0",
        });
        logWsBroadcast(orderbookChannel, "orderbook:updated", { marketId: order.marketId });

        // 3. Broadcast trades to market subscribers and involved parties
        if (tradeExecutions.length > 0) {
            const tradesChannel = `trades:${order.marketId}` as const;
            for (const trade of matchResult.trades) {
                const tradeData = {
                    tradeId: trade.tradeId,
                    marketId: trade.marketId,
                    side: trade.side,
                    price: trade.price.toString(),
                    quantity: trade.quantity.toString(),
                    buyerOrderId: trade.buyerOrderId,
                    sellerOrderId: trade.sellerOrderId,
                };

                // Broadcast to market subscribers
                wsManager.broadcast(tradesChannel, "trade:executed", tradeData);
                logWsBroadcast(tradesChannel, "trade:executed", { tradeId: trade.tradeId });

                // Notify counterparty (the other side of the trade)
                const counterpartyId = trade.buyerId === order.userId ? trade.sellerId : trade.buyerId;
                wsManager.sendToUser(counterpartyId, "orders", "order:filled", {
                    orderId: trade.buyerId === order.userId ? trade.sellerOrderId : trade.buyerOrderId,
                    tradeId: trade.tradeId,
                    price: trade.price.toString(),
                    quantity: trade.quantity.toString(),
                });
                logWsUserMessage(counterpartyId, "orders", "order:filled", { tradeId: trade.tradeId });
            }
        }
    }

    /**
     * Broadcast order cancelled event via WebSocket
     */
    private broadcastOrderCancelled(order: Order): void {
        const orderData = {
            orderId: order.orderId,
            marketId: order.marketId,
            side: order.side,
            status: "cancelled",
        };

        // 1. Notify the order owner
        wsManager.sendToUser(order.userId, "orders", "order:cancelled", orderData);
        logWsUserMessage(order.userId, "orders", "order:cancelled", { orderId: order.orderId });

        // 2. Broadcast orderbook update (order removed)
        const orderbookChannel = `orderbook:${order.marketId}` as const;
        wsManager.broadcast(orderbookChannel, "orderbook:updated", {
            marketId: order.marketId,
            side: order.side,
            type: "remove",
            orderId: order.orderId,
        });
        logWsBroadcast(orderbookChannel, "orderbook:updated", { marketId: order.marketId, type: "remove" });
    }
}

// ============================================
// Error Classes
// ============================================

export class OrderValidationError extends Error {
    constructor(
        message: string,
        public readonly code: string,
    ) {
        super(message);
        this.name = "OrderValidationError";
    }
}

export class OrderNotFoundError extends Error {
    constructor(orderId: string) {
        super(`Order not found: ${orderId}`);
        this.name = "OrderNotFoundError";
    }
}
