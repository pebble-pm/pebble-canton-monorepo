/**
 * Account API Hooks
 *
 * TanStack Query hooks for account and balance data
 */

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { QUERY_KEYS, STALE_TIMES } from "@/lib/constants";
import type { AccountSummaryResponse } from "@/types/api";

// ============================================
// Query Keys
// ============================================

export const accountKeys = {
    all: [QUERY_KEYS.ACCOUNT] as const,
    summary: () => [...accountKeys.all, "summary"] as const,
};

// ============================================
// Queries
// ============================================

/**
 * Get current user's account summary
 */
export function useAccount() {
    const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

    return useQuery({
        queryKey: accountKeys.summary(),
        queryFn: () => apiGet<AccountSummaryResponse>("/account"),
        staleTime: STALE_TIMES.ACCOUNT,
        enabled: isAuthenticated,
    });
}
