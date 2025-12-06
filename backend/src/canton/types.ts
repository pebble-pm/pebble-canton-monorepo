/**
 * Canton JSON Ledger API v2 types
 */

import type { ContractId, PartyId, TransactionId, LedgerOffset } from "../types/daml";

// ============================================
// Configuration
// ============================================

export interface CantonClientConfig {
    host: string;
    port: number;
    useTls: boolean;
    jwtToken?: string;
}

// ============================================
// Command Types
// ============================================

export interface CreateCommand {
    templateId: string;
    createArguments: Record<string, unknown>;
}

export interface ExerciseCommand {
    templateId: string;
    contractId: ContractId;
    choice: string;
    choiceArgument: Record<string, unknown>;
}

export type LedgerCommand = { CreateCommand: CreateCommand } | { ExerciseCommand: ExerciseCommand };

export interface SubmitCommandRequest {
    commands: LedgerCommand[];
    userId: string;
    commandId: string;
    actAs: PartyId[];
    readAs: PartyId[];
}

export interface CommandResult {
    transactionId: TransactionId;
    completionOffset: LedgerOffset;
    contractId?: ContractId; // For create commands
    exerciseResult?: unknown; // For exercise commands
}

// ============================================
// Query Types
// ============================================

export interface ContractFilter {
    templateId: string;
    party: PartyId;
}

export interface Contract<T = Record<string, unknown>> {
    contractId: ContractId;
    templateId: string;
    payload: T;
    createdAt: string;
    signatories: PartyId[];
    observers: PartyId[];
}

export interface ActiveContractsRequest {
    filter: {
        filtersByParty: Record<
            string,
            {
                cumulative: Array<{
                    identifierFilter: {
                        TemplateFilter?: {
                            value: {
                                templateId: string;
                                includeCreatedEventBlob: boolean;
                            };
                        };
                    };
                }>;
            }
        >;
    };
    activeAtOffset: LedgerOffset;
}

// ============================================
// Stream Types
// ============================================

export interface TransactionFilter {
    beginOffset: LedgerOffset;
    templateIds: string[];
    parties?: PartyId[];
}

export interface LedgerEvent {
    eventType: "created" | "archived";
    contractId: ContractId;
    templateId: string;
    createArguments?: Record<string, unknown>;
    stakeholders: PartyId[];
}

export interface TransactionEvent {
    transactionId: TransactionId;
    offset: LedgerOffset;
    events: LedgerEvent[];
}

// ============================================
// Party Management
// ============================================

export interface PartyDetails {
    party: PartyId;
    displayName: string;
    isLocal: boolean;
}

export interface AllocatePartyRequest {
    partyIdHint: string;
    displayName?: string;
}

// ============================================
// User Management (for dev/test)
// ============================================

export interface UserRight {
    kind: {
        CanActAs?: { value: { party: PartyId } };
        CanReadAs?: { value: { party: PartyId } };
        ParticipantAdmin?: Record<string, never>;
    };
}

export interface CreateUserRequest {
    user: {
        id: string;
        primaryParty?: PartyId;
        isDeactivated?: boolean;
    };
    rights: UserRight[];
}

export interface UserDetails {
    id: string;
    primaryParty: PartyId;
    isDeactivated: boolean;
}

// ============================================
// Error Types
// ============================================

export class CantonError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = "CantonError";
    }
}

export class ContractNotFoundError extends CantonError {
    constructor(contractId: ContractId) {
        super(`Contract not found: ${contractId}`, "CONTRACT_NOT_FOUND", {
            contractId,
        });
        this.name = "ContractNotFoundError";
    }
}

export class CommandRejectedError extends CantonError {
    constructor(message: string, details?: Record<string, unknown>) {
        super(message, "COMMAND_REJECTED", details);
        this.name = "CommandRejectedError";
    }
}

export class ConnectionError extends CantonError {
    constructor(message: string) {
        super(message, "CONNECTION_ERROR");
        this.name = "ConnectionError";
    }
}
