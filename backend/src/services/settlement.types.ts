/**
 * Settlement service type definitions
 */

import type { Trade } from "../types";
import type { ContractId, PartyId } from "../types/daml";

/**
 * Configuration for the settlement service
 */
export interface SettlementServiceConfig {
    /** PebbleAdmin party ID for Canton commands */
    pebbleAdminParty: PartyId;
    /** Batch processing interval in milliseconds (default: 2000) */
    batchIntervalMs: number;
    /** Maximum trades per batch (default: 25) */
    maxBatchSize: number;
    /** Maximum retry attempts for failed batches (default: 3) */
    maxRetries: number;
    /** Proposal timeout in milliseconds (default: 300000 = 5 min) */
    proposalTimeoutMs: number;
    /** Delay between settlement rounds in milliseconds (default: 50) */
    roundDelayMs: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_SETTLEMENT_CONFIG: Omit<SettlementServiceConfig, "pebbleAdminParty"> = {
    batchIntervalMs: 2000,
    maxBatchSize: 25,
    maxRetries: 3,
    proposalTimeoutMs: 300000,
    roundDelayMs: 50,
};

/**
 * Mapping of trade ID to proposal contract ID
 */
export interface ProposalMapping {
    tradeId: string;
    proposalCid: ContractId;
    proposalId: string;
}

/**
 * Mapping of trade ID to accepted proposal contract ID
 */
export interface AcceptedProposalMapping {
    tradeId: string;
    acceptedProposalCid: ContractId;
}

/**
 * Mapping of trade ID to final settlement contract ID
 */
export interface SettlementMapping {
    tradeId: string;
    settlementCid: ContractId;
}

/**
 * Context required for executing a single settlement
 */
export interface SettlementExecutionContext {
    trade: Trade;
    settlementCid: ContractId;
    buyerAccountCid: ContractId;
    sellerAccountCid: ContractId;
    buyerPositionCid: ContractId | null;
    sellerPositionCid: ContractId | null;
    marketContractId: ContractId;
}

/**
 * Result of executing a single round of settlements
 */
export interface RoundExecutionResult {
    transactionId: string;
    settledTradeIds: string[];
    failedTradeIds: string[];
}

/**
 * Current status of the settlement service
 */
export interface SettlementServiceStatus {
    /** Number of trades pending settlement */
    pendingCount: number;
    /** Whether a batch is currently being processed */
    isProcessing: boolean;
    /** Timestamp of the last successful batch completion */
    lastBatchTime: Date | null;
    /** Number of batches completed since startup */
    batchesCompleted: number;
    /** Number of batches failed since startup */
    batchesFailed: number;
    /** Whether the service is shutting down */
    isShuttingDown: boolean;
}
