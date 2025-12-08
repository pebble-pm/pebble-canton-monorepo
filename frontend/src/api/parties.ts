/**
 * Party Management API Hooks
 *
 * TanStack Query hooks for party allocation, login, and listing
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { QUERY_KEYS, STALE_TIMES } from "@/lib/constants";
import type {
    PartyResponse,
    AllocatePartyRequest,
    AllocatePartyResponse,
    LoginRequest,
    LoginResponse,
} from "@/types/api";

// ============================================
// Query Keys
// ============================================

export const partyKeys = {
    all: [QUERY_KEYS.PARTIES] as const,
    list: (includeSystem?: boolean) => [...partyKeys.all, "list", { includeSystem }] as const,
};

// ============================================
// Queries
// ============================================

/**
 * List all available parties
 */
export function useParties(includeSystem = false) {
    return useQuery({
        queryKey: partyKeys.list(includeSystem),
        queryFn: () => apiGet<{ parties: PartyResponse[] }>("/parties", { includeSystem }),
        staleTime: STALE_TIMES.PARTIES,
        select: (response) => response.parties,
    });
}

// ============================================
// Mutations
// ============================================

/**
 * Allocate a new party
 */
export function useAllocateParty() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: AllocatePartyRequest) => apiPost<AllocatePartyResponse>("/parties/allocate", request),
        onSuccess: () => {
            // Invalidate parties list to show new party
            queryClient.invalidateQueries({ queryKey: partyKeys.all });
        },
    });
}

/**
 * Login with an existing party
 */
export function useLogin() {
    const login = useAuthStore((state) => state.login);
    const setLoading = useAuthStore((state) => state.setLoading);
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (request: LoginRequest) => {
            setLoading(true);
            const response = await apiPost<LoginResponse>("/parties/login", request);
            return response;
        },
        onSuccess: (response) => {
            login({
                userId: response.userId,
                partyId: response.partyId,
                displayName: response.displayName,
            });

            // Invalidate all queries to refetch with new auth
            queryClient.invalidateQueries();
        },
        onError: () => {
            setLoading(false);
        },
    });
}

/**
 * Logout - client-side only, clears auth state
 */
export function useLogout() {
    const logout = useAuthStore((state) => state.logout);
    const queryClient = useQueryClient();

    return () => {
        logout();
        // Clear all cached data on logout
        queryClient.clear();
    };
}
