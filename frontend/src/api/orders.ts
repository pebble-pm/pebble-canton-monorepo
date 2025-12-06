/**
 * Orders API Hooks
 *
 * TanStack Query hooks for order management
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiDelete } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { QUERY_KEYS, STALE_TIMES } from "@/lib/constants";
import { accountKeys } from "./account";
import { marketKeys } from "./markets";
import type { OrderResponse, PlaceOrderRequest, PlaceOrderResponse } from "@/types/api";

// ============================================
// Query Keys
// ============================================

export const orderKeys = {
    all: [QUERY_KEYS.ORDERS] as const,
    list: (filters?: { marketId?: string; status?: string }) => [...orderKeys.all, "list", filters] as const,
    detail: (orderId: string) => [...orderKeys.all, "detail", orderId] as const,
};

// ============================================
// Queries
// ============================================

/**
 * List user's orders with optional filters
 */
export function useOrders(filters?: { marketId?: string; status?: string }) {
    const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

    return useQuery({
        queryKey: orderKeys.list(filters),
        queryFn: () => apiGet<{ data: OrderResponse[] }>("/orders", filters),
        staleTime: STALE_TIMES.ORDERS,
        enabled: isAuthenticated,
        select: (response) => response.data,
    });
}

/**
 * Get single order details
 */
export function useOrder(orderId: string) {
    const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

    return useQuery({
        queryKey: orderKeys.detail(orderId),
        queryFn: () => apiGet<OrderResponse>(`/orders/${orderId}`),
        staleTime: STALE_TIMES.ORDERS,
        enabled: isAuthenticated && !!orderId,
    });
}

// ============================================
// Mutations
// ============================================

/**
 * Place a new order
 */
export function usePlaceOrder() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (order: PlaceOrderRequest) => apiPost<PlaceOrderResponse>("/orders", order),
        onSuccess: (_data, variables) => {
            // Invalidate orders list
            queryClient.invalidateQueries({ queryKey: orderKeys.all });
            // Invalidate account (balance changed)
            queryClient.invalidateQueries({ queryKey: accountKeys.all });
            // Invalidate the specific market (orderbook may have changed)
            queryClient.invalidateQueries({
                queryKey: marketKeys.detail(variables.marketId),
            });
        },
    });
}

/**
 * Cancel an existing order
 */
export function useCancelOrder() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (orderId: string) => apiDelete<void>(`/orders/${orderId}`),
        onSuccess: () => {
            // Invalidate orders list
            queryClient.invalidateQueries({ queryKey: orderKeys.all });
            // Invalidate account (locked balance may have changed)
            queryClient.invalidateQueries({ queryKey: accountKeys.all });
        },
    });
}
