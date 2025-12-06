/**
 * Admin API Hooks
 *
 * TanStack Query hooks for admin endpoints
 * All endpoints require PebbleAdmin authentication
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api-client";
import { useIsAdmin } from "@/stores/auth.store";
import { marketKeys } from "./markets";

// ============================================
// Types
// ============================================

export interface AdminStats {
    markets: { total: number; open: number; closed: number };
    users: { total: number };
    orders: { total: number; last24h: number };
    trades: { total: number; pending: number; last24h: number };
    volume: { total: string };
    balances: { total: string };
    cantonConnected: boolean;
}

export interface AdminUser {
    userId: string;
    partyId: string;
    displayName: string;
    availableBalance: string;
    lockedBalance: string;
    totalBalance: string;
    hasCantonAccount: boolean;
    positionCount: number;
    orderCount: number;
    faucetRequests: number;
    faucetTotal: string;
    lastUpdated: string;
}

export interface CreateMarketRequest {
    question: string;
    description?: string;
    resolutionTime: string;
}

export interface CreateMarketResponse {
    marketId: string;
    question: string;
    description: string | null;
    resolutionTime: string;
    status: "open";
    contractId?: string;
}

export interface CloseMarketResponse {
    marketId: string;
    status: string;
    message: string;
}

export interface ResolveMarketResponse {
    marketId: string;
    status: string;
    outcome: boolean;
    outcomeLabel: string;
    message: string;
}

// ============================================
// Query Keys
// ============================================

export const adminKeys = {
    all: ["admin"] as const,
    stats: () => [...adminKeys.all, "stats"] as const,
    users: () => [...adminKeys.all, "users"] as const,
};

// ============================================
// Queries
// ============================================

/**
 * Get platform statistics (admin only)
 */
export function useAdminStats() {
    const isAdmin = useIsAdmin();

    return useQuery({
        queryKey: adminKeys.stats(),
        queryFn: () => apiGet<AdminStats>("/admin/stats"),
        staleTime: 30 * 1000, // 30 seconds
        enabled: isAdmin,
        refetchInterval: 60 * 1000, // Refresh every minute
    });
}

/**
 * Get all users (admin only)
 */
export function useAdminUsers() {
    const isAdmin = useIsAdmin();

    return useQuery({
        queryKey: adminKeys.users(),
        queryFn: () => apiGet<{ users: AdminUser[] }>("/admin/users"),
        staleTime: 30 * 1000,
        enabled: isAdmin,
        select: (response) => response.users,
    });
}

// ============================================
// Mutations
// ============================================

/**
 * Create a new market (admin only)
 */
export function useCreateMarket() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: CreateMarketRequest) => apiPost<CreateMarketResponse>("/admin/markets", data),
        onSuccess: () => {
            // Invalidate markets list
            queryClient.invalidateQueries({ queryKey: marketKeys.all });
            // Invalidate admin stats
            queryClient.invalidateQueries({ queryKey: adminKeys.stats() });
        },
    });
}

/**
 * Close a market (admin only)
 */
export function useCloseMarket() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (marketId: string) => apiPost<CloseMarketResponse>(`/admin/markets/${marketId}/close`),
        onSuccess: (_, marketId) => {
            // Invalidate specific market
            queryClient.invalidateQueries({
                queryKey: marketKeys.detail(marketId),
            });
            // Invalidate markets list
            queryClient.invalidateQueries({ queryKey: marketKeys.all });
            // Invalidate admin stats
            queryClient.invalidateQueries({ queryKey: adminKeys.stats() });
        },
    });
}

/**
 * Resolve a market (admin only)
 */
export function useResolveMarket() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ marketId, outcome }: { marketId: string; outcome: boolean }) =>
            apiPost<ResolveMarketResponse>(`/admin/markets/${marketId}/resolve`, { outcome }),
        onSuccess: (_, variables) => {
            // Invalidate specific market
            queryClient.invalidateQueries({
                queryKey: marketKeys.detail(variables.marketId),
            });
            // Invalidate markets list
            queryClient.invalidateQueries({ queryKey: marketKeys.all });
            // Invalidate admin stats
            queryClient.invalidateQueries({ queryKey: adminKeys.stats() });
        },
    });
}
