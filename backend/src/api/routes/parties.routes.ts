/**
 * Parties endpoints
 *
 * GET  /api/parties          - List available demo parties (no auth required)
 * POST /api/parties/allocate - Allocate a new party and create trading account
 */

import { Hono } from "hono";
import Decimal from "decimal.js";
import { getAppContext } from "../../index";
import { BadRequestError, ServiceUnavailableError } from "../types/errors";
import { createCommand, generateCommandId } from "../../canton/client";
import { Templates, Choices } from "../../canton/templates";

const parties = new Hono();

/**
 * GET /api/parties
 * List available demo parties for user selection
 * No authentication required - used for login flow
 *
 * Query params:
 *   - includeSystem=true: Include PebbleAdmin and Oracle parties
 */
parties.get("/", async (c) => {
    const ctx = getAppContext();
    const includeSystem = c.req.query("includeSystem") === "true";

    if (!ctx.canton) {
        return c.json({ parties: [] });
    }

    try {
        const allParties = await ctx.canton.getParties();

        // Filter parties based on includeSystem flag
        const filteredParties = includeSystem
            ? allParties // Include all parties
            : allParties.filter((p) => !p.party.startsWith("Oracle") && !p.party.startsWith("PebbleAdmin"));

        const partyList = filteredParties.map((p) => ({
            id: p.party,
            displayName: p.party.split("::")[0], // Extract "Alice" from "Alice::1220..."
            isSystem: p.party.startsWith("Oracle") || p.party.startsWith("PebbleAdmin"),
        }));

        return c.json({ parties: partyList });
    } catch (error) {
        console.error("[Parties] Failed to fetch parties:", error);
        return c.json({ parties: [] });
    }
});

/**
 * POST /api/parties/allocate
 * Allocate a new party on Canton and create a trading account
 *
 * Request body:
 *   - displayName: string (required) - Display name for the party (e.g., "User123")
 *   - publicKey?: string (optional) - Wallet public key for reference
 *
 * Response:
 *   - partyId: string - The allocated party ID
 *   - displayName: string - The display name
 *   - userId: string - The user ID (same as partyId for now)
 *   - accountCreated: boolean - Whether the trading account was created
 */
parties.post("/allocate", async (c) => {
    const ctx = getAppContext();

    if (!ctx.canton) {
        throw new ServiceUnavailableError("Canton is not available. Please try again later.", "CANTON_UNAVAILABLE");
    }

    const body = await c.req.json();
    const { displayName, publicKey } = body as { displayName?: string; publicKey?: string };

    if (!displayName || typeof displayName !== "string" || displayName.trim().length === 0) {
        throw new BadRequestError("displayName is required", "INVALID_DISPLAY_NAME");
    }

    // Sanitize display name (alphanumeric and underscores only, max 50 chars)
    const sanitizedName = displayName
        .trim()
        .replace(/[^a-zA-Z0-9_]/g, "")
        .slice(0, 50);
    if (sanitizedName.length === 0) {
        throw new BadRequestError(
            "displayName must contain at least one alphanumeric character",
            "INVALID_DISPLAY_NAME",
        );
    }

    // Generate a unique party hint using display name + timestamp
    const partyHint = `${sanitizedName}_${Date.now()}`;

    try {
        // Step 1: Allocate party on Canton
        console.log(`[Parties] Allocating party with hint: ${partyHint}`);
        const partyDetails = await ctx.canton.allocateParty({
            partyIdHint: partyHint,
            displayName: sanitizedName,
        });

        const partyId = partyDetails.party;
        console.log(`[Parties] Allocated party: ${partyId.slice(0, 40)}...`);

        // Step 1b: Grant user rights for the new party (required to submit commands)
        try {
            await ctx.canton.grantPartyRights(partyId);
        } catch (error) {
            console.error("[Parties] Failed to grant party rights:", error);
            // Continue anyway - the party is allocated
        }

        // Step 2: Create trading account on Canton
        let accountCreated = false;
        let accountContractId: string | undefined;
        let authorizationContractId: string | undefined;

        if (ctx.config.parties.pebbleAdmin) {
            try {
                // Create TradingAccountRequest
                // Daml Time in JSON API is represented as ISO 8601 string with microseconds
                const requestedAt = new Date().toISOString();
                const requestResult = await ctx.canton.submitCommand({
                    userId: "pebble-party-service",
                    commandId: generateCommandId(`account-request-${partyHint}`),
                    actAs: [partyId],
                    readAs: [partyId],
                    commands: [
                        createCommand(Templates.TradingAccountRequest, {
                            user: partyId,
                            pebbleAdmin: ctx.config.parties.pebbleAdmin,
                            requestedAt,
                        }),
                    ],
                });

                const requestContractId = requestResult.contractId;
                console.log(`[Parties] Created account request: ${requestContractId?.slice(0, 40)}...`);

                if (requestContractId) {
                    // Accept the account request (creates TradingAccount and PebbleAuthorization)
                    const acceptResult = await ctx.canton.submitCommand({
                        userId: "pebble-party-service",
                        commandId: generateCommandId(`account-accept-${partyHint}`),
                        actAs: [ctx.config.parties.pebbleAdmin],
                        readAs: [ctx.config.parties.pebbleAdmin, partyId],
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

                    // Extract contract IDs from result
                    // The AcceptAccountRequest returns (TradingAccount, PebbleAuthorization)
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

                    accountCreated = true;
                    console.log(`[Parties] Created trading account for ${sanitizedName}`);
                }
            } catch (error) {
                console.error("[Parties] Failed to create trading account:", error);
                // Party is allocated but account creation failed - continue anyway
            }
        }

        // Step 3: Create off-chain account record
        const userId = partyId; // For now, userId = partyId
        ctx.repositories.accounts.create({
            userId,
            partyId,
            accountContractId,
            authorizationContractId,
            availableBalance: new Decimal(0),
            lockedBalance: new Decimal(0),
            lastUpdated: new Date(),
        });
        console.log(`[Parties] Created off-chain account for ${sanitizedName}`);

        return c.json(
            {
                partyId,
                displayName: sanitizedName,
                userId,
                accountCreated,
                publicKey: publicKey || null,
            },
            201,
        );
    } catch (error) {
        console.error("[Parties] Failed to allocate party:", error);
        throw new ServiceUnavailableError("Failed to allocate party. Please try again.", "PARTY_ALLOCATION_FAILED");
    }
});

/**
 * POST /api/parties/login
 * Login as an existing Canton party
 * Creates off-chain account if it doesn't exist
 *
 * Request body:
 *   - partyId: string (required) - The full party ID from Canton
 *
 * Response:
 *   - partyId: string - The party ID
 *   - displayName: string - The display name
 *   - userId: string - The user ID (same as partyId)
 *   - accountExists: boolean - Whether the account already existed
 */
parties.post("/login", async (c) => {
    const ctx = getAppContext();
    const body = await c.req.json();
    const { partyId } = body as { partyId?: string };

    if (!partyId || typeof partyId !== "string" || partyId.trim().length === 0) {
        throw new BadRequestError("partyId is required", "INVALID_PARTY_ID");
    }

    // Extract display name from party ID (e.g., "Alice" from "Alice::1220...")
    const displayName = partyId.split("::")[0];

    // Check if account already exists
    const existingAccount = ctx.repositories.accounts.getById(partyId);
    if (existingAccount) {
        console.log(`[Parties] Login: existing account for ${displayName}`);
        return c.json({
            partyId,
            displayName,
            userId: partyId,
            accountExists: true,
        });
    }

    // Create off-chain account record for this party
    console.log(`[Parties] Login: creating off-chain account for ${displayName}`);
    ctx.repositories.accounts.create({
        userId: partyId,
        partyId,
        accountContractId: undefined, // No on-chain account yet
        authorizationContractId: undefined,
        availableBalance: new Decimal(0),
        lockedBalance: new Decimal(0),
        lastUpdated: new Date(),
    });

    return c.json(
        {
            partyId,
            displayName,
            userId: partyId,
            accountExists: false,
        },
        201,
    );
});

export { parties };
