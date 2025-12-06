/**
 * Settlement types for trade settlement tracking
 */

import type Decimal from "decimal.js";
import type { ContractId } from "./daml";

/** Trade settlement status */
export type SettlementStatus =
    | "pending" // Matched, awaiting settlement
    | "settling" // Settlement in progress on Canton
    | "settled" // Successfully settled
    | "failed"; // Settlement failed

/** Trade entity with settlement info */
export interface Trade {
    tradeId: string;
    marketId: string;
    buyerId: string;
    sellerId: string;
    side: "yes" | "no";
    price: Decimal;
    quantity: Decimal;
    buyerOrderId: string;
    sellerOrderId: string;
    tradeType: "share_trade" | "share_creation";
    settlementId: string;
    settlementStatus: SettlementStatus;
    createdAt: Date;
    settledAt?: Date;
}

/** Settlement batch status */
export type BatchStatus =
    | "pending" // Created, not yet processing
    | "proposing" // Creating SettlementProposal contracts
    | "accepting" // Buyer/Seller accepting proposals
    | "executing" // Executing settlements on Canton
    | "completed" // All settlements successful
    | "failed"; // One or more settlements failed

/** Settlement batch for Canton submission */
export interface SettlementBatch {
    batchId: string;
    tradeIds: string[];
    status: BatchStatus;
    cantonTransactionId?: string;
    createdAt: Date;
    processedAt?: Date;
    retryCount: number;
    lastError?: string;
}

/** Settlement event for audit trail */
export interface SettlementEvent {
    id: number;
    contractId: ContractId;
    settlementId: string;
    transactionId: string;
    status: string;
    timestamp: Date;
}

/** Compensation failure record for manual intervention */
export interface CompensationFailure {
    id: number;
    orderId: string;
    userId: string;
    amount: Decimal;
    accountCid: ContractId;
    error: string;
    timestamp: Date;
    resolved: boolean;
    resolvedAt?: Date;
    resolvedBy?: string;
}

/** Reconciliation record for balance drift tracking */
export interface ReconciliationRecord {
    id: number;
    userId: string;
    previousAvailable: Decimal;
    previousLocked: Decimal;
    onchainAvailable: Decimal;
    onchainLocked: Decimal;
    driftAvailable: Decimal;
    driftLocked: Decimal;
    reconciled: boolean;
    timestamp: Date;
}
