/**
 * Faucet API Hooks
 *
 * TanStack Query hooks for test token faucet
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { accountKeys } from "./account";
import type { FaucetStatusResponse, FaucetRequestResponse } from "@/types/api";

// ============================================
// Query Keys
// ============================================

export const faucetKeys = {
    all: ["faucet"] as const,
    status: () => [...faucetKeys.all, "status"] as const,
};

// ============================================
// Queries
// ============================================

/**
 * Check faucet availability status
 */
export function useFaucetStatus() {
    const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

    return useQuery({
        queryKey: faucetKeys.status(),
        queryFn: () => apiGet<FaucetStatusResponse>("/faucet/status"),
        staleTime: 30 * 1000, // 30 seconds
        enabled: isAuthenticated,
    });
}

// ============================================
// Mutations
// ============================================

/**
 * Request tokens from faucet
 */
export function useFaucetRequest() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (amount?: number) => apiPost<FaucetRequestResponse>("/faucet/request", { amount }),
        onSuccess: () => {
            // Invalidate faucet status (cooldown changed)
            queryClient.invalidateQueries({ queryKey: faucetKeys.all });
            // Invalidate account (balance changed)
            queryClient.invalidateQueries({ queryKey: accountKeys.all });
        },
    });
}
