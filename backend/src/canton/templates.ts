/**
 * Template ID helpers for Pebble contracts
 * Uses package-name reference format required for Daml 3.4
 */

/** Package name for Pebble contracts */
const PEBBLE_PACKAGE = "pebble";

/** Build a template ID in package-name reference format */
export function templateId(module: string, template: string): string {
    return `#${PEBBLE_PACKAGE}:${module}:${template}`;
}

// ============================================
// Template IDs for all Pebble contracts
// ============================================

export const Templates = {
    // Account module
    TradingAccount: templateId("Pebble.Account", "TradingAccount"),
    TradingAccountRequest: templateId("Pebble.Account", "TradingAccountRequest"),
    PebbleAuthorization: templateId("Pebble.Account", "PebbleAuthorization"),

    // Market module
    Market: templateId("Pebble.Market", "Market"),

    // Position module
    Position: templateId("Pebble.Position", "Position"),
    PositionConsolidation: templateId("Pebble.Position", "PositionConsolidation"),
    PositionMerge: templateId("Pebble.Position", "PositionMerge"),

    // Settlement module
    SettlementProposal: templateId("Pebble.Settlement", "SettlementProposal"),
    SettlementProposalAccepted: templateId("Pebble.Settlement", "SettlementProposalAccepted"),
    Settlement: templateId("Pebble.Settlement", "Settlement"),
    MarketSettlement: templateId("Pebble.Settlement", "MarketSettlement"),

    // Oracle module
    AdminOracle: templateId("Pebble.Oracle", "AdminOracle"),
    MultiSigOracle: templateId("Pebble.Oracle", "MultiSigOracle"),
    OracleResolutionRequest: templateId("Pebble.Oracle", "OracleResolutionRequest"),
} as const;

// ============================================
// Choice names for each template
// ============================================

export const Choices = {
    TradingAccount: {
        LockFunds: "LockFunds",
        UnlockFunds: "UnlockFunds",
        DebitForSettlement: "DebitForSettlement",
        CreditFromSettlement: "CreditFromSettlement",
        CreditFromRedemption: "CreditFromRedemption",
        CreditFromDeposit: "CreditFromDeposit",
        WithdrawFunds: "WithdrawFunds",
    },

    TradingAccountRequest: {
        AcceptAccountRequest: "AcceptAccountRequest",
        CancelAccountRequest: "CancelAccountRequest",
    },

    PebbleAuthorization: {
        RevokeAuthorization: "RevokeAuthorization",
        HasPermission: "HasPermission",
    },

    Market: {
        CloseMarket: "CloseMarket",
        ReopenMarket: "ReopenMarket",
        ResolveMarket: "ResolveMarket",
        GetMarketStatus: "GetMarketStatus",
        GetMarketVersion: "GetMarketVersion",
    },

    Position: {
        LockPosition: "LockPosition",
        UnlockPosition: "UnlockPosition",
        AddToPosition: "AddToPosition",
        ReducePosition: "ReducePosition",
    },

    PositionConsolidation: {
        ExecuteConsolidation: "ExecuteConsolidation",
        CancelConsolidation: "CancelConsolidation",
    },

    PositionMerge: {
        ExecuteMerge: "ExecuteMerge",
        CancelMerge: "CancelMerge",
    },

    SettlementProposal: {
        BuyerAccept: "BuyerAccept",
        CancelProposal: "CancelProposal",
        ExpireProposal: "ExpireProposal",
    },

    SettlementProposalAccepted: {
        SellerAccept: "SellerAccept",
        CancelAcceptedProposal: "CancelAcceptedProposal",
        ExpireAcceptedProposal: "ExpireAcceptedProposal",
    },

    Settlement: {
        ExecuteSettlement: "ExecuteSettlement",
        CancelSettlement: "CancelSettlement",
    },

    MarketSettlement: {
        RedeemPosition: "RedeemPosition",
    },

    AdminOracle: {
        SubmitResolution: "SubmitResolution",
        CanResolve: "CanResolve",
    },

    OracleResolutionRequest: {
        ExecuteResolution: "ExecuteResolution",
        CancelResolutionRequest: "CancelResolutionRequest",
        ExpireResolutionRequest: "ExpireResolutionRequest",
    },
} as const;

/** Type-safe template ID type */
export type TemplateId = (typeof Templates)[keyof typeof Templates];

/** Check if a string is a valid Pebble template ID */
export function isPebbleTemplate(id: string): boolean {
    return Object.values(Templates).includes(id as TemplateId);
}
