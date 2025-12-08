/**
 * Party Bootstrap Module
 *
 * Handles creation of test parties (Alice, Bob, Charlie) during backend startup.
 * System parties (PebbleAdmin, Oracle) are created by the Canton sandbox.
 */

import Decimal from "decimal.js";
import type { CantonLedgerClient } from "./client";
import { createCommand, generateCommandId } from "./client";
import { Templates, Choices } from "./templates";
import { logApp, logAppError, logAppWarn } from "../utils/logger";
import type { AccountRepository } from "../db/repositories";

// Default test parties to bootstrap
const DEFAULT_TEST_PARTIES = ["Alice", "Bob", "Charlie"];

// Initial balance for test parties (from faucet)
const INITIAL_BALANCE = 1000;

export interface BootstrapConfig {
    pebbleAdminParty: string;
    testParties?: string[];
    initialBalance?: number;
}

export interface BootstrapResult {
    partiesCreated: string[];
    partiesSkipped: string[];
    errors: string[];
}

/**
 * Bootstrap test parties with trading accounts and initial balance.
 *
 * This function:
 * 1. Checks which test parties already exist
 * 2. Allocates new parties that don't exist
 * 3. Creates TradingAccount for each new party
 * 4. Credits initial balance to each account
 *
 * @param canton - Canton ledger client
 * @param accountRepository - Account repository for off-chain records
 * @param config - Bootstrap configuration
 * @returns Result indicating which parties were created/skipped
 */
export async function bootstrapTestParties(
    canton: CantonLedgerClient,
    accountRepository: AccountRepository,
    config: BootstrapConfig,
): Promise<BootstrapResult> {
    const testParties = config.testParties ?? DEFAULT_TEST_PARTIES;
    const initialBalance = config.initialBalance ?? INITIAL_BALANCE;

    const result: BootstrapResult = {
        partiesCreated: [],
        partiesSkipped: [],
        errors: [],
    };

    if (!config.pebbleAdminParty) {
        logAppWarn("PartyBootstrap", "PebbleAdmin party not configured, skipping bootstrap");
        return result;
    }

    logApp("PartyBootstrap", "Starting test party bootstrap", {
        parties: testParties.join(","),
        initialBalance,
    });

    // Get existing parties from Canton
    const existingParties = await canton.getParties();
    const existingHints = new Map<string, string>();
    for (const p of existingParties) {
        const hint = p.party.split("::")[0];
        existingHints.set(hint, p.party);
    }

    // Process each test party
    for (const partyHint of testParties) {
        try {
            // Check if party already exists
            if (existingHints.has(partyHint)) {
                const existingPartyId = existingHints.get(partyHint)!;

                // Check if off-chain account exists
                const existingAccount = accountRepository.getById(existingPartyId);
                if (existingAccount) {
                    logApp("PartyBootstrap", "Party already exists, skipping", { party: partyHint });
                    result.partiesSkipped.push(partyHint);
                    continue;
                }

                // Party exists on Canton but no off-chain account - create one
                logApp("PartyBootstrap", "Party exists, creating off-chain account", { party: partyHint });
                await createAccountForParty(
                    canton,
                    accountRepository,
                    existingPartyId,
                    config.pebbleAdminParty,
                    initialBalance,
                );
                result.partiesCreated.push(partyHint);
                continue;
            }

            // Allocate new party
            logApp("PartyBootstrap", "Allocating new party", { party: partyHint });
            const partyDetails = await canton.allocateParty({
                partyIdHint: partyHint,
                displayName: partyHint,
            });
            const partyId = partyDetails.party;

            // Grant user rights
            await canton.grantPartyRights(partyId);

            // Create trading account
            await createAccountForParty(canton, accountRepository, partyId, config.pebbleAdminParty, initialBalance);

            result.partiesCreated.push(partyHint);
            logApp("PartyBootstrap", "Party created successfully", { party: partyHint, partyId });
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logAppError("PartyBootstrap", `Failed to bootstrap party ${partyHint}`, error);
            result.errors.push(`${partyHint}: ${errorMsg}`);
        }
    }

    // Summary log
    logApp("PartyBootstrap", "Bootstrap complete", {
        created: result.partiesCreated.length,
        skipped: result.partiesSkipped.length,
        errors: result.errors.length,
    });

    return result;
}

/**
 * Create a trading account for a party and credit initial balance
 */
async function createAccountForParty(
    canton: CantonLedgerClient,
    accountRepository: AccountRepository,
    partyId: string,
    pebbleAdminParty: string,
    initialBalance: number,
): Promise<void> {
    const requestedAt = new Date().toISOString();
    const partyHint = partyId.split("::")[0];

    // Step 1: Create TradingAccountRequest
    const requestResult = await canton.submitCommand({
        userId: "pebble-bootstrap",
        commandId: generateCommandId(`bootstrap-request-${partyHint}`),
        actAs: [partyId],
        readAs: [partyId],
        commands: [
            createCommand(Templates.TradingAccountRequest, {
                user: partyId,
                pebbleAdmin: pebbleAdminParty,
                requestedAt,
            }),
        ],
    });

    const requestContractId = requestResult.contractId;
    if (!requestContractId) {
        throw new Error("Failed to create TradingAccountRequest - no contractId returned");
    }

    // Step 2: Accept the request (creates TradingAccount + PebbleAuthorization)
    const acceptResult = await canton.submitCommand({
        userId: "pebble-bootstrap",
        commandId: generateCommandId(`bootstrap-accept-${partyHint}`),
        actAs: [pebbleAdminParty],
        readAs: [pebbleAdminParty, partyId],
        commands: [
            {
                ExerciseCommand: {
                    templateId: Templates.TradingAccountRequest,
                    contractId: requestContractId,
                    choice: Choices.TradingAccountRequest.AcceptAccountRequest,
                    choiceArgument: {},
                },
            },
        ],
    });

    // Extract contract IDs
    let accountContractId: string | undefined;
    let authorizationContractId: string | undefined;

    if (acceptResult.exerciseResult) {
        const result = acceptResult.exerciseResult as { _1?: string; _2?: string } | [string, string];
        if (Array.isArray(result)) {
            accountContractId = result[0];
            authorizationContractId = result[1];
        } else if (result._1 && result._2) {
            accountContractId = result._1;
            authorizationContractId = result._2;
        }
    }

    // Step 3: Credit initial balance (if > 0 and we have a contract)
    if (initialBalance > 0 && accountContractId) {
        const creditResult = await canton.submitCommand({
            userId: "pebble-bootstrap",
            commandId: generateCommandId(`bootstrap-credit-${partyHint}`),
            actAs: [pebbleAdminParty],
            readAs: [pebbleAdminParty],
            commands: [
                {
                    ExerciseCommand: {
                        templateId: Templates.TradingAccount,
                        contractId: accountContractId,
                        choice: Choices.TradingAccount.CreditFromDeposit,
                        choiceArgument: {
                            amount: String(initialBalance),
                            depositId: `bootstrap-${partyHint}-${Date.now()}`,
                        },
                    },
                },
            ],
        });

        // Update contract ID after credit (consuming choice returns new contract)
        if (creditResult.exerciseResult) {
            accountContractId = String(creditResult.exerciseResult);
        }
    }

    // Step 4: Create off-chain account record
    accountRepository.create({
        userId: partyId,
        partyId,
        accountContractId,
        authorizationContractId,
        availableBalance: new Decimal(initialBalance),
        lockedBalance: new Decimal(0),
        lastUpdated: new Date(),
    });
}

/**
 * Check if bootstrap should run based on configuration
 */
export function shouldBootstrap(): boolean {
    const envValue = process.env.BOOTSTRAP_TEST_PARTIES;

    // Default: true in development, false in production
    if (envValue === undefined) {
        return process.env.NODE_ENV !== "production";
    }

    return envValue.toLowerCase() === "true";
}
