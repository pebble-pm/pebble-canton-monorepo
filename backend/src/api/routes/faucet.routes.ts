/**
 * Faucet endpoints
 *
 * POST /api/faucet/request - Request test funds
 * GET  /api/faucet/status  - Get faucet status for user
 */

import { Hono } from "hono";
import Decimal from "decimal.js";
import { getAppContext } from "../../index";
import { userAuth } from "../middleware";
import { RateLimitError, NotFoundError, ServiceUnavailableError } from "../types/errors";
import { exerciseCommand, generateCommandId } from "../../canton/client";
import { Templates, Choices } from "../../canton/templates";
import { wsManager } from "../websocket/ws-manager";
import { logWsUserMessage } from "../../utils/logger";

const faucet = new Hono();

// Faucet configuration
const FAUCET_CONFIG = {
    initialAmount: 1000, // First request gets 1000 units
    subsequentAmount: 100, // Subsequent requests get 100 units
    cooldownMs: 60 * 60 * 1000, // 1 hour cooldown between requests
};

interface FaucetRequestRow {
    id: number;
    user_id: string;
    party_id: string;
    amount: number;
    is_initial: number;
    transaction_id: string | null;
    created_at: string;
}

// All faucet routes require user authentication
faucet.use("*", userAuth);

/**
 * GET /api/faucet/status
 * Get faucet status for the authenticated user
 *
 * Response:
 *   - canRequest: boolean - Whether the user can request funds now
 *   - nextAvailableAt: string | null - ISO timestamp when next request is available
 *   - lastRequestAt: string | null - ISO timestamp of last request
 *   - totalReceived: string - Total amount received from faucet
 *   - requestCount: number - Total number of faucet requests
 */
faucet.get("/status", async (c) => {
    const ctx = getAppContext();
    const userId = c.get("userId");

    // Get all faucet requests for this user
    const rows = ctx.db.db
        .query("SELECT * FROM faucet_requests WHERE user_id = ? ORDER BY created_at DESC")
        .all(userId) as FaucetRequestRow[];

    const requestCount = rows.length;
    const totalReceived = rows.reduce((sum, row) => sum + row.amount, 0);
    const lastRequest = rows[0];

    let canRequest = true;
    let nextAvailableAt: string | null = null;

    if (lastRequest) {
        const lastRequestTime = new Date(lastRequest.created_at).getTime();
        const nextAvailableTime = lastRequestTime + FAUCET_CONFIG.cooldownMs;
        const now = Date.now();

        if (now < nextAvailableTime) {
            canRequest = false;
            nextAvailableAt = new Date(nextAvailableTime).toISOString();
        }
    }

    return c.json({
        canRequest,
        nextAvailableAt,
        lastRequestAt: lastRequest?.created_at || null,
        totalReceived: totalReceived.toString(),
        requestCount,
        config: {
            initialAmount: FAUCET_CONFIG.initialAmount,
            subsequentAmount: FAUCET_CONFIG.subsequentAmount,
            cooldownMinutes: FAUCET_CONFIG.cooldownMs / 60000,
        },
    });
});

/**
 * POST /api/faucet/request
 * Request test funds from the faucet
 *
 * Rate limited to 1 request per hour per user
 * First request: 1000 units
 * Subsequent requests: 100 units
 *
 * Response:
 *   - amount: string - Amount credited
 *   - newBalance: string - New available balance
 *   - transactionId: string - Transaction ID
 *   - isInitial: boolean - Whether this was the initial (larger) deposit
 *   - nextAvailableAt: string - When next request will be available
 */
faucet.post("/request", async (c) => {
    const ctx = getAppContext();
    const userId = c.get("userId");

    // Get the account
    const account = ctx.repositories.accounts.getById(userId);
    if (!account) {
        throw new NotFoundError("Account not found", "ACCOUNT_NOT_FOUND");
    }

    // Check rate limit
    const lastRequest = ctx.db.db
        .query("SELECT * FROM faucet_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(userId) as FaucetRequestRow | null;

    if (lastRequest) {
        const lastRequestTime = new Date(lastRequest.created_at).getTime();
        const nextAvailableTime = lastRequestTime + FAUCET_CONFIG.cooldownMs;
        const now = Date.now();

        if (now < nextAvailableTime) {
            const waitMinutes = Math.ceil((nextAvailableTime - now) / 60000);
            throw new RateLimitError(
                `Rate limit exceeded. Please wait ${waitMinutes} minutes before requesting again.`,
                Math.ceil((nextAvailableTime - now) / 1000), // Retry-After in seconds
            );
        }
    }

    // Determine amount based on whether this is first request
    const requestCount = ctx.db.db.query("SELECT COUNT(*) as count FROM faucet_requests WHERE user_id = ?").get(userId) as {
        count: number;
    };

    const isInitial = requestCount.count === 0;
    const amount = isInitial ? FAUCET_CONFIG.initialAmount : FAUCET_CONFIG.subsequentAmount;
    const depositAmount = new Decimal(amount);

    // Credit the account on Canton (if connected)
    let transactionId: string = crypto.randomUUID();

    if (ctx.canton && ctx.config.parties.pebbleAdmin && account.accountContractId) {
        console.log(`[Faucet] Submitting CreditFromDeposit to Canton for ${userId.slice(0, 20)}... amount=${amount}`);
        try {
            const result = await ctx.canton.submitCommand({
                userId: "pebble-faucet-service",
                commandId: generateCommandId(`faucet-${userId}`),
                actAs: [ctx.config.parties.pebbleAdmin],
                readAs: [ctx.config.parties.pebbleAdmin],
                commands: [
                    exerciseCommand(Templates.TradingAccount, account.accountContractId, Choices.TradingAccount.CreditFromDeposit, {
                        amount: depositAmount.toString(),
                        depositId: `faucet-${transactionId}`,
                    }),
                ],
            });
            transactionId = result.transactionId || transactionId;
            // Update contractId - CreditFromDeposit is a consuming choice that returns new ContractId
            if (result.exerciseResult) {
                const newContractId = String(result.exerciseResult);
                ctx.repositories.accounts.updateAccountContractId(userId, newContractId);
                console.log(
                    `[Faucet] Canton SUCCESS: txId=${transactionId.slice(0, 20)}..., newContractId=${newContractId.slice(0, 20)}...`,
                );
            } else {
                console.log(`[Faucet] Canton SUCCESS: txId=${transactionId.slice(0, 20)}... (no new contractId returned)`);
            }
        } catch (error) {
            console.error("[Faucet] Canton FAILED:", error instanceof Error ? error.message : error);
            throw new ServiceUnavailableError("Failed to process faucet request on ledger. Please try again.", "CANTON_FAUCET_FAILED");
        }
    } else {
        console.log(`[Faucet] Skipping Canton (offline mode), crediting off-chain only`);
    }

    // Credit the off-chain account
    ctx.repositories.accounts.creditAvailable(userId, depositAmount);

    // Record the faucet request
    const now = new Date().toISOString();
    ctx.db.db.run(
        `INSERT INTO faucet_requests (user_id, party_id, amount, is_initial, transaction_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, account.partyId, amount, isInitial ? 1 : 0, transactionId, now],
    );

    // Get updated balance
    const updatedAccount = ctx.repositories.accounts.getById(userId)!;
    const nextAvailableAt = new Date(Date.now() + FAUCET_CONFIG.cooldownMs).toISOString();

    console.log(`[Faucet] Credited ${amount} to ${userId.slice(0, 30)}... (${isInitial ? "initial" : "subsequent"})`);

    // WebSocket broadcast for balance update
    wsManager.sendToUser(userId, "balance", "balance:updated", {
        reason: "faucet",
        amount: depositAmount.toString(),
        newBalance: updatedAccount.availableBalance.toString(),
        isInitial,
    });
    logWsUserMessage(userId, "balance", "balance:updated", { amount: depositAmount.toString(), reason: "faucet" });

    return c.json(
        {
            amount: depositAmount.toString(),
            newBalance: updatedAccount.availableBalance.toString(),
            transactionId,
            isInitial,
            nextAvailableAt,
        },
        201,
    );
});

export { faucet };
