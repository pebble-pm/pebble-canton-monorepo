/**
 * Account endpoints
 *
 * GET  /api/account           - Get account info
 * POST /api/account/deposit   - Deposit funds
 * POST /api/account/withdraw  - Withdraw funds
 */

import { Hono } from "hono";
import Decimal from "decimal.js";
import { getAppContext } from "../../index";
import { userAuth } from "../middleware";
import { serializeAccount } from "../utils/serialize";
import { validatePositiveNumber } from "../utils/validation";
import { NotFoundError, BadRequestError, ServiceUnavailableError } from "../types/errors";
import type { AccountSummaryResponse, FundTransactionResponse } from "../types/api.types";
import { exerciseCommand, generateCommandId } from "../../canton/client";
import { Templates, Choices } from "../../canton/templates";

const account = new Hono();

// All account routes require user authentication
account.use("*", userAuth);

/**
 * GET /api/account
 * Get account information including balances and total equity
 */
account.get("/", async (c) => {
    const ctx = getAppContext();
    const userId = c.get("userId");

    const acc = ctx.repositories.accounts.getById(userId);
    if (!acc) {
        throw new NotFoundError("Account not found", "ACCOUNT_NOT_FOUND");
    }

    // Calculate positions value
    const positions = ctx.repositories.positions.getByUser(userId, false);
    let positionsValue = new Decimal(0);

    for (const pos of positions) {
        const market = ctx.repositories.markets.getById(pos.marketId);
        if (market) {
            const price = pos.side === "yes" ? market.yesPrice : market.noPrice;
            positionsValue = positionsValue.plus(pos.quantity.mul(price));
        }
    }

    // Total equity = available + locked + positions value
    const totalEquity = acc.availableBalance.plus(acc.lockedBalance).plus(positionsValue);

    const response: AccountSummaryResponse = {
        ...serializeAccount(acc),
        totalEquity: totalEquity.toString(),
        positionsValue: positionsValue.toString(),
        isAuthorized: !!acc.authorizationContractId,
    };

    return c.json(response);
});

/**
 * POST /api/account/deposit
 * Deposit funds into trading account
 *
 * Note: In production, this would verify actual payment via CIP-56
 * For MVP, this is a simulated deposit
 */
account.post("/deposit", async (c) => {
    const ctx = getAppContext();
    const userId = c.get("userId");
    const body = await c.req.json();

    const amount = validatePositiveNumber(body.amount, "amount");
    const depositAmount = new Decimal(amount);

    // Validate maximum deposit (prevent abuse in dev)
    const maxDeposit = new Decimal(1_000_000);
    if (depositAmount.gt(maxDeposit)) {
        throw new BadRequestError(`Deposit amount cannot exceed ${maxDeposit.toString()}`, "DEPOSIT_TOO_LARGE");
    }

    const acc = ctx.repositories.accounts.getById(userId);
    if (!acc) {
        throw new NotFoundError("Account not found", "ACCOUNT_NOT_FOUND");
    }

    // Credit the account on Canton first (if connected)
    let transactionId: string = crypto.randomUUID();

    if (ctx.canton && ctx.config.parties.pebbleAdmin && acc.accountContractId) {
        console.log(`[Account] Submitting CreditFromDeposit to Canton for ${userId.slice(0, 20)}... amount=${depositAmount}`);
        try {
            const result = await ctx.canton.submitCommand({
                userId: "pebble-account-service",
                commandId: generateCommandId(`deposit-${userId}`),
                actAs: [ctx.config.parties.pebbleAdmin],
                readAs: [ctx.config.parties.pebbleAdmin],
                commands: [
                    exerciseCommand(Templates.TradingAccount, acc.accountContractId, Choices.TradingAccount.CreditFromDeposit, {
                        amount: depositAmount.toString(),
                        depositId: `deposit-${transactionId}`,
                    }),
                ],
            });
            transactionId = result.transactionId || transactionId;
            // Update contractId - CreditFromDeposit is a consuming choice that returns new ContractId
            if (result.exerciseResult) {
                const newContractId = String(result.exerciseResult);
                ctx.repositories.accounts.updateAccountContractId(userId, newContractId);
                console.log(
                    `[Account] Deposit SUCCESS: txId=${transactionId.slice(0, 20)}..., newContractId=${newContractId.slice(0, 20)}...`,
                );
            } else {
                console.log(`[Account] Deposit SUCCESS: txId=${transactionId.slice(0, 20)}... (no new contractId returned)`);
            }
        } catch (error) {
            console.error("[Account] Deposit FAILED:", error instanceof Error ? error.message : error);
            throw new ServiceUnavailableError("Failed to process deposit on ledger. Please try again.", "CANTON_DEPOSIT_FAILED");
        }
    } else {
        console.log(`[Account] Skipping Canton (offline mode), crediting off-chain only`);
    }

    // Credit the off-chain account
    ctx.repositories.accounts.creditAvailable(userId, depositAmount);

    const updated = ctx.repositories.accounts.getById(userId)!;

    const response: FundTransactionResponse = {
        transactionId,
        amount: depositAmount.toString(),
        newBalance: updated.availableBalance.toString(),
    };

    return c.json(response, 201);
});

/**
 * POST /api/account/withdraw
 * Withdraw funds from trading account
 */
account.post("/withdraw", async (c) => {
    const ctx = getAppContext();
    const userId = c.get("userId");
    const body = await c.req.json();

    const amount = validatePositiveNumber(body.amount, "amount");
    const withdrawAmount = new Decimal(amount);

    const acc = ctx.repositories.accounts.getById(userId);
    if (!acc) {
        throw new NotFoundError("Account not found", "ACCOUNT_NOT_FOUND");
    }

    // Check sufficient available balance
    if (acc.availableBalance.lt(withdrawAmount)) {
        throw new BadRequestError(
            `Insufficient balance. Available: ${acc.availableBalance.toString()}, Requested: ${withdrawAmount.toString()}`,
            "INSUFFICIENT_BALANCE",
        );
    }

    // Execute withdrawal on Canton first (if connected)
    let transactionId: string = crypto.randomUUID();

    if (ctx.canton && ctx.config.parties.pebbleAdmin && acc.accountContractId) {
        console.log(`[Account] Submitting WithdrawFunds to Canton for ${userId.slice(0, 20)}... amount=${withdrawAmount}`);
        try {
            // WithdrawFunds choice has controller = owner, so we must actAs the user's party
            const result = await ctx.canton.submitCommand({
                userId: "pebble-account-service",
                commandId: generateCommandId(`withdraw-${userId}`),
                actAs: [acc.partyId], // Use owner party, not pebbleAdmin
                readAs: [acc.partyId, ctx.config.parties.pebbleAdmin],
                commands: [
                    exerciseCommand(Templates.TradingAccount, acc.accountContractId, Choices.TradingAccount.WithdrawFunds, {
                        amount: withdrawAmount.toString(),
                    }),
                ],
            });
            transactionId = result.transactionId || transactionId;
            // Update contractId - WithdrawFunds is a consuming choice that returns new ContractId
            if (result.exerciseResult) {
                const newContractId = String(result.exerciseResult);
                ctx.repositories.accounts.updateAccountContractId(userId, newContractId);
                console.log(
                    `[Account] Withdraw SUCCESS: txId=${transactionId.slice(0, 20)}..., newContractId=${newContractId.slice(0, 20)}...`,
                );
            } else {
                console.log(`[Account] Withdraw SUCCESS: txId=${transactionId.slice(0, 20)}... (no new contractId returned)`);
            }
        } catch (error) {
            console.error("[Account] Withdraw FAILED:", error instanceof Error ? error.message : error);
            throw new ServiceUnavailableError("Failed to process withdrawal on ledger. Please try again.", "CANTON_WITHDRAW_FAILED");
        }
    } else {
        console.log(`[Account] Skipping Canton (offline mode), debiting off-chain only`);
    }

    // Debit from off-chain available balance
    const newAvailable = acc.availableBalance.minus(withdrawAmount);
    ctx.repositories.accounts.updateBalances(userId, newAvailable, acc.lockedBalance);

    const response: FundTransactionResponse = {
        transactionId,
        amount: withdrawAmount.toString(),
        newBalance: newAvailable.toString(),
    };

    return c.json(response);
});

export { account };
