/**
 * Positions API Hooks
 *
 * TanStack Query hooks for position management
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { QUERY_KEYS, STALE_TIMES } from "@/lib/constants";
import { accountKeys } from "./account";
import type { PositionWithValueResponse, RedeemPositionRequest, RedemptionResponse } from "@/types/api";

// ============================================
// Query Keys
// ============================================

export const positionKeys = {
    all: [QUERY_KEYS.POSITIONS] as const,
    list: (marketId?: string) => [...positionKeys.all, "list", { marketId }] as const,
};

// ============================================
// Queries
// ============================================

/**
 * List user's positions with optional market filter
 */
export function usePositions(marketId?: string) {
    const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

    return useQuery({
        queryKey: positionKeys.list(marketId),
        queryFn: () =>
            apiGet<{ data: PositionWithValueResponse[] }>("/positions", {
                marketId,
            }),
        staleTime: STALE_TIMES.POSITIONS,
        enabled: isAuthenticated,
        select: (response) => response.data,
    });
}

// ============================================
// Mutations
// ============================================

/**
 * Redeem a winning position after market resolution
 */
export function useRedeemPosition() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: RedeemPositionRequest) => apiPost<RedemptionResponse>("/positions/redeem", request),
        onSuccess: () => {
            // Invalidate positions list
            queryClient.invalidateQueries({ queryKey: positionKeys.all });
            // Invalidate account (balance changed from redemption)
            queryClient.invalidateQueries({ queryKey: accountKeys.all });
        },
    });
}
