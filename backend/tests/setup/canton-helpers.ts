/**
 * Canton-specific test helpers for integration tests
 *
 * These helpers interact with the Canton sandbox for:
 * - Party allocation
 * - Contract creation and queries
 * - Command submission
 */

import { testId } from "./test-env";
import type { PebbleConfig } from "../../src/config";

// ============================================
// Types
// ============================================

export interface CantonTestClient {
    baseUrl: string;
    submitCommand: (command: CantonCommand) => Promise<CantonCommandResult>;
    getActiveContracts: (filter: ContractFilter) => Promise<Contract[]>;
    allocateParty: (hint: string) => Promise<string>;
    isConnected: () => Promise<boolean>;
}

export interface CantonCommand {
    userId: string;
    commandId: string;
    actAs: string[];
    readAs: string[];
    commands: LedgerCommand[];
}

export interface LedgerCommand {
    CreateCommand?: {
        templateId: string;
        createArguments: Record<string, unknown>;
    };
    ExerciseCommand?: {
        templateId: string;
        contractId: string;
        choice: string;
        choiceArgument: Record<string, unknown>;
    };
}

export interface CantonCommandResult {
    transactionId?: string;
    contractId?: string;
    exerciseResult?: unknown;
    error?: string;
}

export interface ContractFilter {
    templateId: string;
    party: string;
}

export interface Contract {
    contractId: string;
    templateId: string;
    payload: Record<string, unknown>;
}

// ============================================
// Canton Test Client
// ============================================

/**
 * Create a Canton test client for integration tests
 */
export function createCantonTestClient(config: PebbleConfig): CantonTestClient {
    const baseUrl = `http://${config.canton.host}:${config.canton.port}`;

    return {
        baseUrl,

        async submitCommand(command: CantonCommand): Promise<CantonCommandResult> {
            const response = await fetch(`${baseUrl}/v2/commands`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    commands: {
                        applicationId: "pebble-test",
                        commandId: command.commandId,
                        actAs: command.actAs,
                        readAs: command.readAs,
                        commands: command.commands,
                    },
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                return { error: `Command submission failed: ${errorText}` };
            }

            const result = (await response.json()) as {
                transactionId?: string;
                createdContractIds?: string[];
                exerciseResult?: unknown;
            };
            return {
                transactionId: result.transactionId,
                contractId: result.createdContractIds?.[0],
                exerciseResult: result.exerciseResult,
            };
        },

        async getActiveContracts(filter: ContractFilter): Promise<Contract[]> {
            const response = await fetch(`${baseUrl}/v2/state/acs`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    filter: {
                        filtersByParty: {
                            [filter.party]: {
                                templateIds: [filter.templateId],
                            },
                        },
                    },
                }),
            });

            if (!response.ok) {
                return [];
            }

            const result = (await response.json()) as {
                activeContracts?: Array<{
                    contractId: string;
                    templateId: string;
                    payload: Record<string, unknown>;
                }>;
            };
            return (result.activeContracts ?? []).map(
                (c: { contractId: string; templateId: string; payload: Record<string, unknown> }) => ({
                    contractId: c.contractId,
                    templateId: c.templateId,
                    payload: c.payload,
                }),
            );
        },

        async allocateParty(hint: string): Promise<string> {
            const response = await fetch(`${baseUrl}/v2/parties`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    displayName: hint,
                    identifierHint: hint,
                }),
            });

            if (!response.ok) {
                throw new Error(`Failed to allocate party: ${await response.text()}`);
            }

            const result = (await response.json()) as { party: string };
            return result.party;
        },

        async isConnected(): Promise<boolean> {
            try {
                const response = await fetch(`${baseUrl}/v2/version`);
                return response.ok;
            } catch {
                return false;
            }
        },
    };
}

// ============================================
// Test Party Management
// ============================================

export interface TestParties {
    pebbleAdmin: string;
    oracle: string;
    alice: string;
    bob: string;
    charlie: string;
}

/**
 * Setup test parties for integration tests
 */
export async function setupTestParties(client: CantonTestClient): Promise<TestParties> {
    // Check if parties already exist by trying to use them
    // If Canton sandbox was started fresh, we need to allocate

    const suffix = testId("").substring(0, 8);

    return {
        pebbleAdmin: await allocateOrGetParty(client, `PebbleAdmin_${suffix}`),
        oracle: await allocateOrGetParty(client, `Oracle_${suffix}`),
        alice: await allocateOrGetParty(client, `Alice_${suffix}`),
        bob: await allocateOrGetParty(client, `Bob_${suffix}`),
        charlie: await allocateOrGetParty(client, `Charlie_${suffix}`),
    };
}

async function allocateOrGetParty(client: CantonTestClient, hint: string): Promise<string> {
    try {
        return await client.allocateParty(hint);
    } catch {
        // Party might already exist
        return hint;
    }
}

// ============================================
// Contract Helpers
// ============================================

/**
 * Create a TradingAccount for a test user
 */
export async function createTestAccount(client: CantonTestClient, pebbleAdmin: string, user: string): Promise<string> {
    // First create a TradingAccountRequest
    const requestResult = await client.submitCommand({
        userId: "test",
        commandId: testId("create-request"),
        actAs: [user],
        readAs: [user],
        commands: [
            {
                CreateCommand: {
                    templateId: "#pebble:Pebble.Account:TradingAccountRequest",
                    createArguments: {
                        user,
                        pebbleAdmin,
                        requestedAt: new Date().toISOString(),
                    },
                },
            },
        ],
    });

    if (requestResult.error || !requestResult.contractId) {
        throw new Error(`Failed to create account request: ${requestResult.error}`);
    }

    // Accept the request
    const acceptResult = await client.submitCommand({
        userId: "test",
        commandId: testId("accept-request"),
        actAs: [pebbleAdmin],
        readAs: [pebbleAdmin],
        commands: [
            {
                ExerciseCommand: {
                    templateId: "#pebble:Pebble.Account:TradingAccountRequest",
                    contractId: requestResult.contractId,
                    choice: "AcceptAccountRequest",
                    choiceArgument: {},
                },
            },
        ],
    });

    if (acceptResult.error) {
        throw new Error(`Failed to accept account request: ${acceptResult.error}`);
    }

    // Return the account contract ID
    return acceptResult.contractId ?? "";
}

/**
 * Create a test market
 */
export async function createTestMarket(
    client: CantonTestClient,
    pebbleAdmin: string,
    options: {
        marketId?: string;
        question?: string;
        description?: string;
        resolutionTime?: Date;
    } = {},
): Promise<string> {
    const marketId = options.marketId ?? testId("market");
    const now = new Date();
    const resolutionTime = options.resolutionTime ?? new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const result = await client.submitCommand({
        userId: "test",
        commandId: testId("create-market"),
        actAs: [pebbleAdmin],
        readAs: [pebbleAdmin],
        commands: [
            {
                CreateCommand: {
                    templateId: "#pebble:Pebble.Market:Market",
                    createArguments: {
                        marketId,
                        admin: pebbleAdmin,
                        question: options.question ?? "Will this test pass?",
                        description: options.description ?? "Test market",
                        resolutionTime: resolutionTime.toISOString(),
                        createdAt: now.toISOString(),
                        status: "Open",
                        outcome: null,
                        version: 0,
                    },
                },
            },
        ],
    });

    if (result.error) {
        throw new Error(`Failed to create market: ${result.error}`);
    }

    return result.contractId ?? marketId;
}

/**
 * Fund a test account by calling CreditFromDeposit
 */
export async function fundTestAccount(
    client: CantonTestClient,
    pebbleAdmin: string,
    accountContractId: string,
    amount: number,
): Promise<string> {
    const result = await client.submitCommand({
        userId: "test",
        commandId: testId("fund-account"),
        actAs: [pebbleAdmin],
        readAs: [pebbleAdmin],
        commands: [
            {
                ExerciseCommand: {
                    templateId: "#pebble:Pebble.Account:TradingAccount",
                    contractId: accountContractId,
                    choice: "CreditFromDeposit",
                    choiceArgument: {
                        amount: amount.toString(),
                        depositId: testId("deposit"),
                    },
                },
            },
        ],
    });

    if (result.error) {
        throw new Error(`Failed to fund account: ${result.error}`);
    }

    return result.contractId ?? "";
}

// ============================================
// Skip Integration Tests Helper
// ============================================

/**
 * Check if integration tests should run (Canton must be available)
 */
export async function shouldRunIntegrationTests(client: CantonTestClient): Promise<boolean> {
    return await client.isConnected();
}

/**
 * Skip test if Canton is not available
 */
export async function skipIfNoCandon(client: CantonTestClient): Promise<void> {
    const connected = await client.isConnected();
    if (!connected) {
        throw new Error("Canton sandbox not available. Start it with: cd canton && ./scripts/start.sh");
    }
}
