/**
 * Root Route Layout
 *
 * Provides the main app shell with sidebar navigation
 */

import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { useWebSocket, useUserSubscriptions } from "@/hooks/use-websocket";
import { Wifi, WifiOff } from "lucide-react";

export const Route = createRootRoute({
    component: RootLayout,
});

function RootLayout() {
    return (
        <>
            <WebSocketProvider />
            <AppShell>
                <Outlet />
            </AppShell>
            <Toaster position="bottom-right" />
        </>
    );
}

/**
 * Initializes WebSocket connection and user subscriptions
 */
function WebSocketProvider() {
    const { isConnected } = useWebSocket({ autoConnect: true });

    // Subscribe to user-specific channels
    useUserSubscriptions();

    // Connection status indicator (only in dev)
    if (import.meta.env.DEV) {
        return (
            <div
                className="fixed bottom-4 right-4 z-50 flex items-center gap-1.5 rounded-full bg-background/80 backdrop-blur px-3 py-1.5 text-xs border shadow-sm"
                title={isConnected ? "WebSocket connected" : "WebSocket disconnected"}
            >
                {isConnected ? (
                    <>
                        <Wifi className="h-3 w-3 text-green-500" />
                        <span className="text-green-500">WS</span>
                    </>
                ) : (
                    <>
                        <WifiOff className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">WS</span>
                    </>
                )}
            </div>
        );
    }

    return null;
}
