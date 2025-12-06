/**
 * Position types for off-chain projections
 */

import type Decimal from "decimal.js";

/** Position projection - user's holding in a market */
export interface Position {
    positionId: string; // Canton ContractId
    userId: string; // Party ID
    marketId: string;
    side: "yes" | "no"; // Lowercase for API
    quantity: Decimal;
    lockedQuantity: Decimal; // Shares locked in pending sell orders
    avgCostBasis: Decimal;

    // Canton contract reference
    contractId?: string;

    // Computed fields (from market prices)
    currentValue?: Decimal;
    unrealizedPnL?: Decimal;

    lastUpdated: Date;
    isArchived: boolean;
}

/** Summary of all positions for a user */
export interface PositionSummary {
    positions: Position[];
    totalValue: Decimal;
    totalPnL: Decimal;
}

/** Request to merge YES + NO positions back to collateral */
export interface MergePositionsRequest {
    marketId: string;
    quantity: number; // Number of pairs to merge
}

/** Response from position merge */
export interface MergePositionsResponse {
    payout: Decimal; // quantity * $1.00
    transactionId: string;
    remainingYesQuantity: Decimal;
    remainingNoQuantity: Decimal;
}

/** Request to redeem a winning position */
export interface RedeemPositionRequest {
    positionId: string;
}

/** Response from position redemption */
export interface RedeemPositionResponse {
    payout: Decimal;
    transactionId: string;
}

/** Position update for WebSocket notifications */
export interface PositionUpdate {
    positionId: string;
    userId: string;
    marketId: string;
    side: "yes" | "no";
    quantity: Decimal;
    lockedQuantity: Decimal;
    timestamp: Date;
}
