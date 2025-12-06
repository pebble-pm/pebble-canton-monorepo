/**
 * Market types for off-chain projections and API
 */

import type Decimal from "decimal.js";
import type { ContractId } from "./daml";
import type { OrderBookLevel } from "./order";

/** Market projection - denormalized view for API queries */
export interface Market {
    marketId: string;
    question: string;
    description: string;
    resolutionTime: Date;
    createdAt: Date;
    status: "open" | "closed" | "resolved"; // Lowercase for API
    outcome?: boolean;

    // Off-chain computed fields
    yesPrice: Decimal; // Last traded or mid price
    noPrice: Decimal; // Always 1 - yesPrice
    volume24h: Decimal;
    totalVolume: Decimal;
    openInterest: Decimal;

    // Canton contract reference
    contractId?: ContractId;
    version?: number;
    lastUpdated: Date;
}

/** Request to create a new market */
export interface CreateMarketRequest {
    question: string;
    description: string;
    resolutionTime: string; // ISO date string
}

/** Request to resolve a market */
export interface ResolveMarketRequest {
    outcome: boolean; // true = YES wins
    evidence?: string; // Optional supporting evidence
}

// OrderBookLevel is defined in order.ts and re-exported via index.ts

/** Public trade info (no user IDs) */
export interface TradePublic {
    tradeId: string;
    marketId: string;
    side: "yes" | "no";
    price: Decimal;
    quantity: Decimal;
    timestamp: Date;
}

/** Market with orderbook and recent trades for API response */
export interface MarketDetail extends Market {
    orderbook: {
        yes: {
            bids: OrderBookLevel[];
            asks: OrderBookLevel[];
        };
        no: {
            bids: OrderBookLevel[];
            asks: OrderBookLevel[];
        };
    };
    recentTrades: TradePublic[];
}

/** Market list item for API response (subset of fields) */
export interface MarketSummary {
    marketId: string;
    question: string;
    status: "open" | "closed" | "resolved";
    outcome?: boolean;
    yesPrice: Decimal;
    noPrice: Decimal;
    volume24h: Decimal;
    resolutionTime: Date;
}
