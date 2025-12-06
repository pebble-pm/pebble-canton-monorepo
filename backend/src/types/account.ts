/**
 * Account types for trading account projections
 */

import type Decimal from "decimal.js";
import type { ContractId } from "./daml";

/** Trading account projection */
export interface TradingAccount {
    userId: string;
    partyId: string; // Canton Party ID
    accountContractId?: ContractId;
    authorizationContractId?: ContractId;
    availableBalance: Decimal;
    lockedBalance: Decimal;
    lastUpdated: Date;
}

/** Account summary for API response */
export interface AccountSummary {
    userId: string;
    partyId: string;
    availableBalance: Decimal;
    lockedBalance: Decimal;
    totalEquity: Decimal; // Available + locked + positions value
    isAuthorized: boolean;
}

/** Deposit request */
export interface DepositRequest {
    amount: number;
}

/** Deposit response */
export interface DepositResponse {
    transactionId: string;
    amount: Decimal;
    newBalance: Decimal;
}

/** Withdraw request */
export interface WithdrawRequest {
    amount: number;
    destinationParty?: string; // If not specified, withdraws to user's party
}

/** Withdraw response */
export interface WithdrawResponse {
    transactionId: string;
    amount: Decimal;
    newBalance: Decimal;
}

/** Balance update for WebSocket notifications */
export interface BalanceUpdate {
    userId: string;
    availableBalance: Decimal;
    lockedBalance: Decimal;
    timestamp: Date;
}
