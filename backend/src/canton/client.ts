/**
 * Canton JSON Ledger API v2 client
 * Implements command submission, contract queries, and transaction streaming
 */

import type {
    CantonClientConfig,
    SubmitCommandRequest,
    CommandResult,
    ContractFilter,
    Contract,
    TransactionFilter,
    TransactionEvent,
    LedgerEvent,
    PartyDetails,
    AllocatePartyRequest,
    LedgerCommand,
} from "./types";
import { CantonError, CommandRejectedError, ConnectionError } from "./types";
import type { LedgerOffset, PartyId, ContractId } from "../types/daml";
import { logLedgerSubmit, logLedgerSuccess, logLedgerError, logApp, logAppWarn } from "../utils/logger";

export interface CantonLedgerClient {
    // Command submission
    submitCommand(request: SubmitCommandRequest): Promise<CommandResult>;

    // Contract queries
    getActiveContracts<T>(filter: ContractFilter): Promise<Contract<T>[]>;
    getContract<T>(contractId: string, party: PartyId): Promise<Contract<T> | null>;

    // Ledger state
    getLedgerEnd(): Promise<{ offset: LedgerOffset }>;

    // Transaction streaming (SSE)
    streamTransactions(filter: TransactionFilter): AsyncIterableIterator<TransactionEvent>;

    // Party management
    getParties(): Promise<PartyDetails[]>;
    allocateParty(request: AllocatePartyRequest): Promise<PartyDetails>;
    grantPartyRights(partyId: string, userId?: string): Promise<void>;
}

export class CantonJsonClient implements CantonLedgerClient {
    private baseUrl: string;
    private headers: Record<string, string>;

    constructor(config: CantonClientConfig) {
        const protocol = config.useTls ? "https" : "http";
        this.baseUrl = `${protocol}://${config.host}:${config.port}`;

        this.headers = {
            "Content-Type": "application/json",
        };

        if (config.jwtToken) {
            this.headers["Authorization"] = `Bearer ${config.jwtToken}`;
        }
    }

    /**
     * Submit a command and wait for completion
     * Uses /v2/commands/submit-and-wait endpoint
     */
    async submitCommand(request: SubmitCommandRequest): Promise<CommandResult> {
        const body = {
            commands: request.commands,
            userId: request.userId,
            commandId: request.commandId,
            actAs: request.actAs,
            readAs: request.readAs,
        };

        // Extract template/choice info for logging
        const cmdInfo = this.extractCommandInfo(request.commands);
        const logContext = {
            party: request.actAs[0],
            ...cmdInfo.context,
        };

        logLedgerSubmit(cmdInfo.action, cmdInfo.template, logContext);

        // Use submit-and-wait-for-transaction-tree to get full transaction with events/contractIds
        const response = await fetch(`${this.baseUrl}/v2/commands/submit-and-wait-for-transaction-tree`, {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: response.statusText }));
            logLedgerError(cmdInfo.action, cmdInfo.template, error, logContext);
            throw new CommandRejectedError(
                `Canton command failed: ${JSON.stringify(error)}`,
                error as Record<string, unknown>,
            );
        }

        const result = (await response.json()) as {
            transactionTree?: {
                updateId: string;
                commandId: string;
                offset: number | string;
                eventsById: Record<
                    string,
                    {
                        CreatedTreeEvent?: {
                            value: {
                                contractId: string;
                                templateId: string;
                                createArgument: Record<string, unknown>;
                            };
                        };
                        ExercisedTreeEvent?: {
                            value: {
                                contractId: string;
                                choice: string;
                                exerciseResult: unknown;
                            };
                        };
                    }
                >;
            };
        };

        // Extract created contract ID and exercise result from transaction tree
        let contractId: string | undefined;
        let exerciseResult: unknown;

        if (result.transactionTree?.eventsById) {
            for (const event of Object.values(result.transactionTree.eventsById)) {
                if (event.CreatedTreeEvent?.value) {
                    contractId = event.CreatedTreeEvent.value.contractId;
                }
                if (event.ExercisedTreeEvent?.value?.exerciseResult !== undefined) {
                    exerciseResult = event.ExercisedTreeEvent.value.exerciseResult;
                }
            }
        }

        const txId = result.transactionTree?.updateId ?? "";
        logLedgerSuccess(cmdInfo.action, cmdInfo.template, txId, contractId, logContext);

        return {
            transactionId: txId,
            completionOffset: String(result.transactionTree?.offset ?? ""),
            contractId,
            exerciseResult,
        };
    }

    /**
     * Extract template and choice info from commands for logging
     */
    private extractCommandInfo(commands: LedgerCommand[]): {
        action: "CREATE" | "EXERCISE";
        template: string;
        context: Record<string, string>;
    } {
        const cmd = commands[0];
        if (!cmd) {
            return { action: "CREATE", template: "Unknown", context: {} };
        }

        if ("CreateCommand" in cmd) {
            const templateId = cmd.CreateCommand.templateId;
            const templateName = templateId.split(":").pop() || templateId;
            return {
                action: "CREATE",
                template: templateName,
                context: {},
            };
        }

        if ("ExerciseCommand" in cmd) {
            const templateId = cmd.ExerciseCommand.templateId;
            const templateName = templateId.split(":").pop() || templateId;
            const choice = cmd.ExerciseCommand.choice;
            return {
                action: "EXERCISE",
                template: `${templateName}.${choice}`,
                context: { contractId: cmd.ExerciseCommand.contractId },
            };
        }

        return { action: "CREATE", template: "Unknown", context: {} };
    }

    /**
     * Query active contracts by template and party
     */
    async getActiveContracts<T>(filter: ContractFilter): Promise<Contract<T>[]> {
        const ledgerEnd = await this.getLedgerEnd();

        const body = {
            filter: {
                filtersByParty: {
                    [filter.party]: {
                        cumulative: [
                            {
                                identifierFilter: {
                                    TemplateFilter: {
                                        value: {
                                            templateId: filter.templateId,
                                            includeCreatedEventBlob: true,
                                        },
                                    },
                                },
                            },
                        ],
                    },
                },
            },
            activeAtOffset: ledgerEnd.offset,
        };

        const response = await fetch(`${this.baseUrl}/v2/state/active-contracts`, {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new CantonError(`Failed to query active contracts: ${response.statusText}`, "QUERY_FAILED");
        }

        // Canton 3.4 returns array with contractEntry.JsActiveContract.createdEvent structure
        const result = await response.json();
        const activeContracts = this.parseActiveContractsResponse(result);

        return activeContracts.map((c) => ({
            contractId: c.contractId,
            templateId: c.templateId,
            payload: c.payload as T,
            createdAt: c.createdAt ?? "",
            signatories: c.signatories || [],
            observers: c.observers || [],
        }));
    }

    /**
     * Get a specific contract by ID
     */
    async getContract<T>(contractId: string, party: PartyId): Promise<Contract<T> | null> {
        // Canton doesn't have a direct "get by ID" endpoint
        // We need to use a workaround - query all contracts and filter
        // This is not efficient for large sets, but works for MVP
        try {
            const ledgerEnd = await this.getLedgerEnd();

            const response = await fetch(`${this.baseUrl}/v2/state/active-contracts`, {
                method: "POST",
                headers: this.headers,
                body: JSON.stringify({
                    filter: {
                        filtersByParty: {
                            [party]: {},
                        },
                    },
                    activeAtOffset: ledgerEnd.offset,
                }),
            });

            if (!response.ok) {
                return null;
            }

            // Canton 3.4 returns array with contractEntry.JsActiveContract.createdEvent structure
            const result = await response.json();
            const contracts = this.parseActiveContractsResponse(result);
            const contract = contracts.find((c) => c.contractId === contractId);

            if (!contract) {
                return null;
            }

            return {
                contractId: contract.contractId,
                templateId: contract.templateId,
                payload: contract.payload as T,
                createdAt: contract.createdAt ?? "",
                signatories: contract.signatories || [],
                observers: contract.observers || [],
            };
        } catch {
            return null;
        }
    }

    /**
     * Parse active contracts response handling Canton 3.4 format
     */
    private parseActiveContractsResponse(result: unknown): Array<{
        contractId: string;
        templateId: string;
        payload: unknown;
        createdAt: string;
        signatories: string[];
        observers: string[];
    }> {
        // Canton 3.4 returns array directly with contractEntry.JsActiveContract.createdEvent
        if (Array.isArray(result)) {
            return result
                .map((item) => {
                    const event = item?.contractEntry?.JsActiveContract?.createdEvent;
                    if (!event) return null;
                    return {
                        contractId: event.contractId,
                        templateId: event.templateId,
                        payload: event.createArgument || event.payload,
                        createdAt: event.createdAt ?? "",
                        signatories: event.signatories || [],
                        observers: event.observers || [],
                    };
                })
                .filter((c): c is NonNullable<typeof c> => c !== null);
        }

        // Legacy format: { activeContracts: [...] }
        const legacy = result as {
            activeContracts?: Array<{
                contractId: string;
                templateId: string;
                createArguments?: unknown;
                payload?: unknown;
                createdAt?: string;
                signatories?: string[];
                observers?: string[];
            }>;
        };

        return (legacy.activeContracts || []).map((c) => ({
            contractId: c.contractId,
            templateId: c.templateId,
            payload: c.createArguments || c.payload,
            createdAt: c.createdAt ?? "",
            signatories: c.signatories || [],
            observers: c.observers || [],
        }));
    }

    /**
     * Get current ledger end offset
     */
    async getLedgerEnd(): Promise<{ offset: LedgerOffset }> {
        const response = await fetch(`${this.baseUrl}/v2/state/ledger-end`, {
            method: "GET",
            headers: this.headers,
        });

        if (!response.ok) {
            throw new CantonError(`Failed to get ledger end: ${response.statusText}`, "LEDGER_END_FAILED");
        }

        return response.json() as Promise<{ offset: LedgerOffset }>;
    }

    /**
     * Stream transactions using WebSocket (Canton 3.4 JSON API)
     */
    async *streamTransactions(filter: TransactionFilter): AsyncIterableIterator<TransactionEvent> {
        // Canton 3.4 uses WebSocket for /v2/updates
        // Convert HTTP URL to WebSocket URL
        const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/v2/updates";

        // Build the request message for Canton 3.4 format
        const requestMessage = {
            beginExclusive: filter.beginOffset === "0" ? 0 : parseInt(filter.beginOffset, 10) || 0,
            updateFormat: {
                includeTransactions: {
                    eventFormat: {
                        filtersByParty: {},
                        filtersForAnyParty: {
                            cumulative: filter.templateIds.map((templateId) => ({
                                identifierFilter: {
                                    TemplateFilter: {
                                        value: {
                                            templateId,
                                            includeCreatedEventBlob: true,
                                        },
                                    },
                                },
                            })),
                        },
                    },
                    transactionShape: "TRANSACTION_SHAPE_ACS_DELTA",
                },
            },
        };

        // Use Bun's native WebSocket
        const ws = new WebSocket(wsUrl);

        // Create a queue to handle incoming messages
        const messageQueue: TransactionEvent[] = [];
        let resolveNext: ((value: IteratorResult<TransactionEvent>) => void) | null = null;
        let wsError: Error | null = null;
        let wsClosed = false;

        ws.onopen = () => {
            ws.send(JSON.stringify(requestMessage));
        };

        ws.onmessage = (event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data as string) as {
                    update?: {
                        Transaction?: {
                            transactionId?: string;
                            updateId?: string;
                            offset?: string | number;
                            events?: Array<{
                                created?: {
                                    contractId: string;
                                    templateId: string;
                                    createArguments?: Record<string, unknown>;
                                    witnessParties?: string[];
                                    signatories?: string[];
                                    observers?: string[];
                                };
                                archived?: {
                                    contractId: string;
                                    templateId: string;
                                    witnessParties?: string[];
                                };
                            }>;
                        };
                    };
                    transaction?: {
                        transactionId?: string;
                        updateId?: string;
                        offset?: string | number;
                        events?: Array<{
                            created?: {
                                contractId: string;
                                templateId: string;
                                createArguments?: Record<string, unknown>;
                                witnessParties?: string[];
                                signatories?: string[];
                                observers?: string[];
                            };
                            archived?: {
                                contractId: string;
                                templateId: string;
                                witnessParties?: string[];
                            };
                        }>;
                    };
                };

                // Handle both wrapped and unwrapped transaction formats
                const txn = data.update?.Transaction || data.transaction;
                if (txn) {
                    const transactionEvent: TransactionEvent = {
                        transactionId: txn.transactionId || txn.updateId || "",
                        offset: String(txn.offset || ""),
                        events: this.parseEvents(txn.events || []),
                    };

                    if (resolveNext) {
                        const resolve = resolveNext;
                        resolveNext = null;
                        resolve({ value: transactionEvent, done: false });
                    } else {
                        messageQueue.push(transactionEvent);
                    }
                }
            } catch {
                // Skip malformed messages
            }
        };

        ws.onerror = (event: Event) => {
            wsError = new CantonError(
                `WebSocket error: ${(event as ErrorEvent).message || "unknown"}`,
                "STREAM_FAILED",
            );
            if (resolveNext) {
                // Don't reject, just close the iterator
                wsClosed = true;
                const resolve = resolveNext;
                resolveNext = null;
                resolve({ value: undefined as unknown as TransactionEvent, done: true });
            }
        };

        ws.onclose = () => {
            wsClosed = true;
            if (resolveNext) {
                const resolve = resolveNext;
                resolveNext = null;
                resolve({ value: undefined as unknown as TransactionEvent, done: true });
            }
        };

        try {
            while (true) {
                if (wsError) {
                    throw wsError;
                }

                if (messageQueue.length > 0) {
                    yield messageQueue.shift()!;
                } else if (wsClosed) {
                    break;
                } else {
                    // Wait for next message
                    const result = await new Promise<IteratorResult<TransactionEvent>>((resolve) => {
                        resolveNext = resolve;
                    });
                    if (result.done) break;
                    yield result.value;
                }
            }
        } finally {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            }
        }
    }

    private parseEvents(
        events: Array<{
            created?: {
                contractId: string;
                templateId: string;
                createArguments?: Record<string, unknown>;
                stakeholders?: string[];
                witnessParties?: string[];
                signatories?: string[];
                observers?: string[];
            };
            archived?: {
                contractId: string;
                templateId: string;
                stakeholders?: string[];
                witnessParties?: string[];
            };
        }>,
    ): LedgerEvent[] {
        return events.map((e) => ({
            eventType: e.created ? "created" : "archived",
            contractId: e.created?.contractId || e.archived?.contractId || "",
            templateId: e.created?.templateId || e.archived?.templateId || "",
            createArguments: e.created?.createArguments,
            // Canton 3.4 uses witnessParties instead of stakeholders
            stakeholders:
                e.created?.stakeholders ||
                e.created?.witnessParties ||
                e.archived?.stakeholders ||
                e.archived?.witnessParties ||
                [],
        }));
    }

    /**
     * Get all allocated parties
     */
    async getParties(): Promise<PartyDetails[]> {
        const response = await fetch(`${this.baseUrl}/v2/parties`, {
            method: "GET",
            headers: this.headers,
        });

        if (!response.ok) {
            throw new CantonError(`Failed to get parties: ${response.statusText}`, "PARTIES_FAILED");
        }

        const result = (await response.json()) as {
            partyDetails?: PartyDetails[];
        };
        return result.partyDetails || [];
    }

    /**
     * Allocate a new party
     */
    async allocateParty(request: AllocatePartyRequest): Promise<PartyDetails> {
        logApp("Canton", "Allocating party", { hint: request.partyIdHint });

        const response = await fetch(`${this.baseUrl}/v2/parties`, {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify({
                partyIdHint: request.partyIdHint,
                displayName: request.displayName,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            logLedgerError("CREATE", "Party", errorText, { hint: request.partyIdHint });
            throw new CantonError(`Failed to allocate party: ${response.statusText}`, "ALLOCATE_PARTY_FAILED");
        }

        const result = (await response.json()) as { partyDetails?: PartyDetails } | PartyDetails;

        // Handle both wrapped and unwrapped response formats
        if ("partyDetails" in result && result.partyDetails) {
            logApp("Canton", "Party allocated", { party: result.partyDetails.party });
            return result.partyDetails;
        }

        // Direct response format
        if ("party" in result) {
            logApp("Canton", "Party allocated", { party: (result as PartyDetails).party });
            return result as PartyDetails;
        }

        throw new CantonError("Unexpected response format from allocateParty", "ALLOCATE_PARTY_FAILED");
    }

    /**
     * Create or update a user with rights to act as a party
     * This is required for newly allocated parties to submit commands
     */
    async grantPartyRights(partyId: string, userId?: string): Promise<void> {
        const effectiveUserId = userId || partyId.split("::")[0];

        // First, try to create the user
        const createResponse = await fetch(`${this.baseUrl}/v2/users`, {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify({
                user: {
                    id: effectiveUserId,
                    primaryParty: partyId,
                    isDeactivated: false,
                    identityProviderId: "",
                },
                rights: [
                    { kind: { CanActAs: { value: { party: partyId } } } },
                    { kind: { CanReadAs: { value: { party: partyId } } } },
                ],
            }),
        });

        if (createResponse.ok) {
            logApp("Canton", "Created user with rights", { userId: effectiveUserId, party: partyId });
            return;
        }

        // If user already exists (409), try to grant rights
        if (createResponse.status === 409) {
            const grantResponse = await fetch(`${this.baseUrl}/v2/users/${effectiveUserId}/rights`, {
                method: "POST",
                headers: this.headers,
                body: JSON.stringify({
                    rights: [
                        { kind: { CanActAs: { value: { party: partyId } } } },
                        { kind: { CanReadAs: { value: { party: partyId } } } },
                    ],
                }),
            });

            if (grantResponse.ok) {
                logApp("Canton", "Granted rights to existing user", { userId: effectiveUserId });
                return;
            }

            const errorText = await grantResponse.text();
            logLedgerError("CREATE", "UserRights", errorText, { userId: effectiveUserId });
        } else {
            const errorText = await createResponse.text();
            logLedgerError("CREATE", "User", errorText, { userId: effectiveUserId });
        }

        // Don't throw - party allocation succeeded, just rights failed
        logAppWarn("Canton", "Could not grant user rights, commands may fail", { party: partyId });
    }
}

/**
 * Factory function to create and verify a Canton client connection
 */
export async function createCantonClient(config: CantonClientConfig): Promise<CantonLedgerClient> {
    const client = new CantonJsonClient(config);

    // Verify connection by fetching ledger end
    try {
        await client.getLedgerEnd();
        logApp("Canton", "Connected to Ledger API v2", { host: config.host, port: config.port });
    } catch (error) {
        throw new ConnectionError(`Failed to connect to Canton at ${config.host}:${config.port}: ${error}`);
    }

    return client;
}

// ============================================
// Command Builder Helpers
// ============================================

/**
 * Build a CreateCommand
 */
export function createCommand(templateId: string, createArguments: Record<string, unknown>): LedgerCommand {
    return {
        CreateCommand: {
            templateId,
            createArguments,
        },
    };
}

/**
 * Build an ExerciseCommand
 */
export function exerciseCommand(
    templateId: string,
    contractId: ContractId,
    choice: string,
    choiceArgument: Record<string, unknown> = {},
): LedgerCommand {
    return {
        ExerciseCommand: {
            templateId,
            contractId,
            choice,
            choiceArgument,
        },
    };
}

/**
 * Generate a unique command ID
 */
export function generateCommandId(prefix: string = "cmd"): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
