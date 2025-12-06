/**
 * WebSocket handler for Bun.serve
 *
 * Handles WebSocket upgrade, authentication, and message routing
 */

import type { ServerWebSocket } from "bun";
import { wsManager, type WsData, type Channel } from "./ws-manager";
import { getAppContext } from "../../index";

/** Inbound message from client */
interface WsInboundMessage {
    type: "subscribe" | "unsubscribe" | "auth" | "ping";
    channel?: string;
    channels?: string[];
    token?: string;
}

/**
 * Simple JWT decode (no signature verification for MVP)
 */
function decodeToken(token: string): { userId: string; exp?: number } | null {
    try {
        const parts = token.split(".");
        if (parts.length !== 3) return null;

        const payload = JSON.parse(atob(parts[1]));

        // Check expiration if present
        if (payload.exp && payload.exp * 1000 < Date.now()) {
            return null; // Token expired
        }

        const userId = payload.sub || payload.userId || payload.user_id;
        if (!userId) return null;

        return { userId, exp: payload.exp };
    } catch {
        return null;
    }
}

/**
 * Validate channel name
 */
function isValidChannel(channel: string): channel is Channel {
    // User channels
    if (["positions", "orders", "balance"].includes(channel)) {
        return true;
    }

    // Market channels with format: channelType:marketId
    if (channel.startsWith("orderbook:") || channel.startsWith("trades:")) {
        const parts = channel.split(":");
        return parts.length === 2 && parts[1].length > 0;
    }

    return false;
}

/**
 * Bun WebSocket handlers
 */
export const websocketHandlers = {
    /**
     * Called when a WebSocket connection is opened
     */
    open(ws: ServerWebSocket<WsData>) {
        const connectionId = ws.data.connectionId;
        wsManager.addConnection(connectionId, ws);

        // Send welcome message
        ws.send(
            JSON.stringify({
                type: "connected",
                connectionId,
                timestamp: new Date().toISOString(),
            }),
        );
    },

    /**
     * Called when a message is received
     */
    message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
        const connectionId = ws.data.connectionId;
        wsManager.updatePing(connectionId);

        try {
            const data = JSON.parse(typeof message === "string" ? message : message.toString()) as WsInboundMessage;

            switch (data.type) {
                case "auth":
                    handleAuth(ws, connectionId, data.token);
                    break;

                case "subscribe":
                    handleSubscribe(ws, connectionId, data.channel, data.channels);
                    break;

                case "unsubscribe":
                    handleUnsubscribe(connectionId, data.channel, data.channels);
                    break;

                case "ping":
                    ws.send(
                        JSON.stringify({
                            type: "pong",
                            timestamp: new Date().toISOString(),
                        }),
                    );
                    break;

                default:
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: `Unknown message type: ${(data as any).type}`,
                            timestamp: new Date().toISOString(),
                        }),
                    );
            }
        } catch (err) {
            ws.send(
                JSON.stringify({
                    type: "error",
                    message: "Invalid message format",
                    timestamp: new Date().toISOString(),
                }),
            );
        }
    },

    /**
     * Called when a WebSocket connection is closed
     */
    close(ws: ServerWebSocket<WsData>) {
        wsManager.removeConnection(ws.data.connectionId);
    },

    /**
     * Called when an error occurs
     */
    error(ws: ServerWebSocket<WsData>, error: Error) {
        console.error(`[WS] Error on ${ws.data.connectionId}:`, error);
        wsManager.removeConnection(ws.data.connectionId);
    },
};

/**
 * Handle authentication message
 */
function handleAuth(ws: ServerWebSocket<WsData>, connectionId: string, token?: string): void {
    if (!token) {
        ws.send(
            JSON.stringify({
                type: "error",
                code: "AUTH_FAILED",
                message: "Token required for authentication",
                timestamp: new Date().toISOString(),
            }),
        );
        return;
    }

    const decoded = decodeToken(token);
    if (!decoded) {
        ws.send(
            JSON.stringify({
                type: "error",
                code: "AUTH_FAILED",
                message: "Invalid or expired token",
                timestamp: new Date().toISOString(),
            }),
        );
        return;
    }

    // Verify user exists
    const ctx = getAppContext();
    const account = ctx.repositories.accounts.getById(decoded.userId);
    if (!account) {
        ws.send(
            JSON.stringify({
                type: "error",
                code: "AUTH_FAILED",
                message: "User not found",
                timestamp: new Date().toISOString(),
            }),
        );
        return;
    }

    wsManager.authenticate(connectionId, decoded.userId);

    ws.send(
        JSON.stringify({
            type: "authenticated",
            userId: decoded.userId,
            timestamp: new Date().toISOString(),
        }),
    );
}

/**
 * Handle subscribe message
 */
function handleSubscribe(ws: ServerWebSocket<WsData>, connectionId: string, channel?: string, channels?: string[]): void {
    const channelsToSubscribe = channels || (channel ? [channel] : []);

    if (channelsToSubscribe.length === 0) {
        ws.send(
            JSON.stringify({
                type: "error",
                message: "No channel specified",
                timestamp: new Date().toISOString(),
            }),
        );
        return;
    }

    const subscribed: string[] = [];
    const failed: Array<{ channel: string; error: string }> = [];

    for (const ch of channelsToSubscribe) {
        if (!isValidChannel(ch)) {
            failed.push({ channel: ch, error: "Invalid channel name" });
            continue;
        }

        if (wsManager.subscribe(connectionId, ch)) {
            subscribed.push(ch);
        } else {
            failed.push({ channel: ch, error: "Subscription failed" });
        }
    }

    if (failed.length > 0) {
        ws.send(
            JSON.stringify({
                type: "subscription_result",
                subscribed,
                failed,
                timestamp: new Date().toISOString(),
            }),
        );
    }
}

/**
 * Handle unsubscribe message
 */
function handleUnsubscribe(connectionId: string, channel?: string, channels?: string[]): void {
    const channelsToUnsubscribe = channels || (channel ? [channel] : []);

    for (const ch of channelsToUnsubscribe) {
        if (isValidChannel(ch)) {
            wsManager.unsubscribe(connectionId, ch);
        }
    }
}

/**
 * Create a WebSocket upgrade response for Hono
 * This allows upgrading HTTP requests to WebSocket
 */
export function upgradeWebSocket(req: Request, server: ReturnType<typeof Bun.serve>): Response | undefined {
    // Check for query param token
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    const connectionId = crypto.randomUUID();

    const upgraded = server.upgrade(req, {
        data: { connectionId } as WsData,
    });

    if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // If token was in query, authenticate after connection
    // This will be handled in the open handler or via auth message
    if (token) {
        // Store token for deferred authentication
        // Note: Due to timing, we handle this via message after connection
        setTimeout(() => {
            const ws = Array.from((server as any).pendingWebSockets?.values() || []).find(
                (w: any) => w.data?.connectionId === connectionId,
            );
            if (ws) {
                const decoded = decodeToken(token);
                if (decoded) {
                    wsManager.authenticate(connectionId, decoded.userId);
                }
            }
        }, 100);
    }

    return undefined;
}
