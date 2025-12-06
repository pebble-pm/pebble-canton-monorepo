/**
 * Markets API Hooks
 *
 * TanStack Query hooks for market data
 */

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { QUERY_KEYS, STALE_TIMES } from "@/lib/constants";
import type { MarketResponse, MarketDetailResponse } from "@/types/api";

// ============================================
// Query Keys
// ============================================

export const marketKeys = {
    all: [QUERY_KEYS.MARKETS] as const,
    list: (status?: string) => [...marketKeys.all, "list", { status }] as const,
    detail: (marketId: string) => [...marketKeys.all, "detail", marketId] as const,
};

// ============================================
// Queries
// ============================================

/**
 * List all markets with optional status filter
 */
export function useMarkets(status?: "open" | "closed" | "resolved") {
    return useQuery({
        queryKey: marketKeys.list(status),
        queryFn: () => apiGet<{ data: MarketResponse[] }>("/markets", { status }),
        staleTime: STALE_TIMES.MARKETS,
        select: (response) => response.data,
    });
}

/**
 * Get single market with orderbook and recent trades
 */
export function useMarket(marketId: string) {
    return useQuery({
        queryKey: marketKeys.detail(marketId),
        queryFn: () => apiGet<MarketDetailResponse>(`/markets/${marketId}`),
        staleTime: STALE_TIMES.MARKET_DETAIL,
        enabled: !!marketId,
    });
}
