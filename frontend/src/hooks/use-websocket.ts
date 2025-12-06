/**
 * WebSocket Hook
 *
 * Manages WebSocket connection and subscriptions with TanStack Query integration
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WsClient, createWsClient, type WsChannel } from "@/lib/ws-client";
import { useAuthStore } from "@/stores/auth.store";
import { marketKeys } from "@/api/markets";
import { orderKeys } from "@/api/orders";
import { positionKeys } from "@/api/positions";
import { accountKeys } from "@/api/account";
import type { WsOutboundEvent } from "@/types/api";

interface UseWebSocketOptions {
    /** Auto-connect when authenticated */
    autoConnect?: boolean;
    /** Channels to subscribe to on connect */
    channels?: WsChannel[];
}

interface UseWebSocketReturn {
    /** Whether WebSocket is connected */
    isConnected: boolean;
    /** Whether user is authenticated on WebSocket */
    isAuthenticated: boolean;
    /** Subscribe to a channel */
    subscribe: (channel: WsChannel) => void;
    /** Unsubscribe from a channel */
    unsubscribe: (channel: WsChannel) => void;
    /** Connect to WebSocket */
    connect: () => void;
    /** Disconnect from WebSocket */
    disconnect: () => void;
}

/**
 * Global WebSocket hook for the application
 * Automatically connects when user is authenticated
 */
export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
    const { autoConnect = true, channels = [] } = options;

    const queryClient = useQueryClient();
    const userId = useAuthStore((state) => state.userId);
    const isStoreAuthenticated = useAuthStore((state) => state.isAuthenticated);

    const [isConnected, setIsConnected] = useState(false);
    const [isWsAuthenticated, setIsWsAuthenticated] = useState(false);

    const wsRef = useRef<WsClient | null>(null);
    const channelsRef = useRef<WsChannel[]>(channels);

    // Update channels ref when prop changes
    useEffect(() => {
        channelsRef.current = channels;
    }, [channels]);

    // Handle WebSocket events and invalidate queries
    const handleWsMessage = useCallback(
        (event: WsOutboundEvent) => {
            const channel = event.channel;

            switch (event.type) {
                case "orderbook_update":
                    // Invalidate specific market orderbook
                    if (channel?.startsWith("orderbook:")) {
                        const marketId = channel.replace("orderbook:", "");
                        queryClient.invalidateQueries({
                            queryKey: marketKeys.detail(marketId),
                        });
                    }
                    break;

                case "trade":
                    // Invalidate trades for market
                    if (channel?.startsWith("trades:")) {
                        const marketId = channel.replace("trades:", "");
                        queryClient.invalidateQueries({
                            queryKey: marketKeys.detail(marketId),
                        });
                    }
                    break;

                case "order_update":
                    // Invalidate orders list
                    queryClient.invalidateQueries({
                        queryKey: orderKeys.all,
                    });
                    break;

                case "position_update":
                    // Invalidate positions list
                    queryClient.invalidateQueries({
                        queryKey: positionKeys.all,
                    });
                    break;

                case "balance_update":
                    // Invalidate account balance
                    queryClient.invalidateQueries({
                        queryKey: accountKeys.all,
                    });
                    break;

                case "market_update":
                    // Invalidate markets list
                    queryClient.invalidateQueries({
                        queryKey: marketKeys.all,
                    });
                    break;
            }
        },
        [queryClient],
    );

    // Initialize WebSocket client
    useEffect(() => {
        if (wsRef.current) return;

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}/ws`;

        wsRef.current = createWsClient({
            url: wsUrl,
            onConnect: () => setIsConnected(true),
            onDisconnect: () => {
                setIsConnected(false);
                setIsWsAuthenticated(false);
            },
            onMessage: handleWsMessage,
        });

        return () => {
            wsRef.current?.disconnect();
            wsRef.current = null;
        };
    }, [handleWsMessage]);

    // Auto-connect when authenticated
    useEffect(() => {
        if (!wsRef.current || !autoConnect) return;

        if (isStoreAuthenticated && userId) {
            wsRef.current.connect();
        } else {
            wsRef.current.disconnect();
        }
    }, [autoConnect, isStoreAuthenticated, userId]);

    // Authenticate on connection
    useEffect(() => {
        if (!wsRef.current || !isConnected || !userId) return;

        wsRef.current.authenticate(userId);

        // Poll for auth status (simple approach since we don't have events for this)
        const checkAuth = setInterval(() => {
            if (wsRef.current?.isAuthenticated()) {
                setIsWsAuthenticated(true);
                clearInterval(checkAuth);
            }
        }, 100);

        return () => clearInterval(checkAuth);
    }, [isConnected, userId]);

    // Subscribe to initial channels when authenticated
    useEffect(() => {
        if (!wsRef.current || !isWsAuthenticated) return;

        channelsRef.current.forEach((channel) => {
            wsRef.current?.subscribe(channel);
        });
    }, [isWsAuthenticated]);

    const subscribe = useCallback((channel: WsChannel) => {
        wsRef.current?.subscribe(channel);
    }, []);

    const unsubscribe = useCallback((channel: WsChannel) => {
        wsRef.current?.unsubscribe(channel);
    }, []);

    const connect = useCallback(() => {
        wsRef.current?.connect();
    }, []);

    const disconnect = useCallback(() => {
        wsRef.current?.disconnect();
    }, []);

    return {
        isConnected,
        isAuthenticated: isWsAuthenticated,
        subscribe,
        unsubscribe,
        connect,
        disconnect,
    };
}

/**
 * Hook to subscribe to a specific market's orderbook and trades
 */
export function useMarketSubscription(marketId: string | undefined) {
    const { subscribe, unsubscribe, isAuthenticated } = useWebSocket();

    useEffect(() => {
        if (!marketId || !isAuthenticated) return;

        const orderbookChannel: WsChannel = `orderbook:${marketId}`;
        const tradesChannel: WsChannel = `trades:${marketId}`;

        subscribe(orderbookChannel);
        subscribe(tradesChannel);

        return () => {
            unsubscribe(orderbookChannel);
            unsubscribe(tradesChannel);
        };
    }, [marketId, isAuthenticated, subscribe, unsubscribe]);
}

/**
 * Hook to subscribe to user-specific channels (positions, orders, balance)
 */
export function useUserSubscriptions() {
    const { subscribe, unsubscribe, isAuthenticated } = useWebSocket();

    useEffect(() => {
        if (!isAuthenticated) return;

        subscribe("positions");
        subscribe("orders");
        subscribe("balance");

        return () => {
            unsubscribe("positions");
            unsubscribe("orders");
            unsubscribe("balance");
        };
    }, [isAuthenticated, subscribe, unsubscribe]);
}
