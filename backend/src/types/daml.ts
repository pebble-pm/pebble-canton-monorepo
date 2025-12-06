/**
 * Daml-specific types mirroring the on-chain contracts
 * See: daml/src/Pebble/Types.daml
 */

import Decimal from "decimal.js";

// ============================================
// Core Daml Enums (from Pebble.Types)
// ============================================

/** Market lifecycle status - mirrors Daml MarketStatus */
export type MarketStatus = "Open" | "Closed" | "Resolved";

/** Position side in a binary market - mirrors Daml PositionSide */
export type PositionSide = "YES" | "NO";

/** Trade execution type - mirrors Daml TradeType */
export type TradeType = "ShareTrade" | "ShareCreation";

/** Permission types for authorization - mirrors Daml PebblePermission */
export type PebblePermission = "SettlementPermission" | "OrderManagementPermission" | "WithdrawalPermission";

// ============================================
// Canton Contract Types
// ============================================

/** Canton contract identifier */
export type ContractId = string;

/** Canton party identifier */
export type PartyId = string;

/** Canton transaction identifier */
export type TransactionId = string;

/** Canton ledger offset */
export type LedgerOffset = string;

// ============================================
// Daml Contract Payloads
// ============================================

/** Market contract payload - mirrors Pebble.Market:Market */
export interface MarketPayload {
    marketId: string;
    admin: PartyId;
    question: string;
    description: string;
    resolutionTime: string; // ISO timestamp
    createdAt: string;
    status: MarketStatus;
    outcome: boolean | null;
    version: number;
}

/** TradingAccount contract payload - mirrors Pebble.Account:TradingAccount */
export interface TradingAccountPayload {
    owner: PartyId;
    pebbleAdmin: PartyId;
    ccHoldingCids: ContractId[];
    availableBalance: string; // Decimal as string
    lockedBalance: string;
}

/** TradingAccountRequest payload - mirrors Pebble.Account:TradingAccountRequest */
export interface TradingAccountRequestPayload {
    user: PartyId;
    pebbleAdmin: PartyId;
    requestedAt: string; // ISO timestamp
}

/** PebbleAuthorization payload - mirrors Pebble.Account:PebbleAuthorization */
export interface PebbleAuthorizationPayload {
    user: PartyId;
    pebbleAdmin: PartyId;
    grantedAt: string; // ISO timestamp
    permissions: PebblePermission[];
}

/** Position contract payload - mirrors Pebble.Position:Position */
export interface PositionPayload {
    owner: PartyId;
    pebbleAdmin: PartyId;
    marketId: string;
    side: PositionSide;
    quantity: string; // Decimal as string
    lockedQuantity: string;
    avgCostBasis: string;
}

/** SettlementProposal payload - mirrors Pebble.Settlement:SettlementProposal */
export interface SettlementProposalPayload {
    pebbleAdmin: PartyId;
    buyer: PartyId;
    seller: PartyId;
    marketId: string;
    side: PositionSide;
    quantity: string;
    price: string;
    proposalId: string;
    createdAt: string;
    tradeType: TradeType;
    sellerPositionLockedQuantity: string | null;
    marketContractId: ContractId;
}

/** Settlement contract payload - mirrors Pebble.Settlement:Settlement */
export interface SettlementPayload {
    pebbleAdmin: PartyId;
    buyer: PartyId;
    seller: PartyId;
    marketId: string;
    side: PositionSide;
    quantity: string;
    price: string;
    settlementId: string;
    createdAt: string;
    tradeType: TradeType;
    sellerPositionLockedQuantity: string | null;
    marketContractId: ContractId;
}

/** SettlementResult - result of ExecuteSettlement choice */
export interface SettlementResultPayload {
    settlementId: string;
    buyerAccountCid: ContractId;
    sellerAccountCid: ContractId;
    buyerPositionCid: ContractId | null;
    sellerPositionCid: ContractId | null;
}

/** OracleResolutionRequest payload - mirrors Pebble.Oracle:OracleResolutionRequest */
export interface OracleResolutionRequestPayload {
    oracle: PartyId;
    pebbleAdmin: PartyId;
    marketCid: ContractId;
    marketId: string;
    outcome: boolean;
    evidence: string | null;
    createdAt: string;
    expiresAt: string;
    expectedMarketStatus: MarketStatus;
    expectedMarketVersion: number;
}

/** MarketSettlement payload - mirrors Pebble.Settlement:MarketSettlement */
export interface MarketSettlementPayload {
    pebbleAdmin: PartyId;
    marketId: string;
    outcome: boolean;
    settledAt: string;
}

// ============================================
// Decimal Helpers
// ============================================

/** Type alias for monetary values using Decimal */
export type Money = Decimal;

/** Type alias for prices (0.01 to 0.99) */
export type Price = Decimal;

/** Type alias for share quantities */
export type Quantity = Decimal;

/** Parse a Daml Decimal string to Decimal.js */
export function parseDamlDecimal(value: string): Decimal {
    return new Decimal(value);
}

/** Format a Decimal for Daml contract arguments */
export function toDamlDecimal(value: Decimal): string {
    return value.toFixed(10); // Daml uses up to 10 decimal places
}

/** Format a Date for Daml timestamp fields */
export function toDamlTime(date: Date): string {
    return date.toISOString();
}

/** Parse a Daml timestamp to Date */
export function fromDamlTime(value: string): Date {
    return new Date(value);
}
