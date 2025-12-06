/**
 * WebSocket connection and channel management
 *
 * Manages WebSocket connections, authentication, and channel subscriptions
 * for real-time updates to clients
 */

import type { ServerWebSocket } from "bun";

/** Channel types for subscriptions */
export type Channel =
    | `orderbook:${string}` // Orderbook updates for a market
    | `trades:${string}` // Trade updates for a market
    | "positions" // User's position updates
    | "orders" // User's order updates
    | "balance"; // User's balance updates

/** WebSocket connection info */
interface WsConnection {
    ws: ServerWebSocket<WsData>;
    userId?: string;
    channels: Set<Channel>;
    lastPing: number;
    connectedAt: number;
}

/** Data attached to WebSocket */
export interface WsData {
    connectionId: string;
}

/** Message sent from server to client */
export interface WsOutMessage {
    type: string;
    channel?: string;
    event?: string;
    data?: unknown;
    timestamp?: string; // Added automatically by send()
    error?: string;
    message?: string;
}

/**
 * WebSocket Manager
 * Singleton class managing all WebSocket connections and broadcasting
 */
export class WebSocketManager {
    private connections = new Map<string, WsConnection>();
    private channelSubscribers = new Map<Channel, Set<string>>();
    private userConnections = new Map<string, Set<string>>(); // userId -> connectionIds
    private pingInterval: ReturnType<typeof setInterval> | null = null;
    private isShuttingDown = false;

    constructor() {
        // Start ping/pong health check every 30 seconds
        this.pingInterval = setInterval(() => this.checkConnections(), 30000);
        if (this.pingInterval.unref) {
            this.pingInterval.unref();
        }
    }

    /**
     * Register a new WebSocket connection
     */
    addConnection(connectionId: string, ws: ServerWebSocket<WsData>): void {
        if (this.isShuttingDown) return;

        const now = Date.now();
        this.connections.set(connectionId, {
            ws,
            channels: new Set(),
            lastPing: now,
            connectedAt: now,
        });
        console.log(`[WS] Connection added: ${connectionId.slice(0, 8)}...`);
    }

    /**
     * Remove a WebSocket connection
     */
    removeConnection(connectionId: string): void {
        const conn = this.connections.get(connectionId);
        if (!conn) return;

        // Unsubscribe from all channels
        for (const channel of conn.channels) {
            this.unsubscribe(connectionId, channel);
        }

        // Remove from user connections
        if (conn.userId) {
            const userConns = this.userConnections.get(conn.userId);
            if (userConns) {
                userConns.delete(connectionId);
                if (userConns.size === 0) {
                    this.userConnections.delete(conn.userId);
                }
            }
        }

        this.connections.delete(connectionId);
        console.log(`[WS] Connection removed: ${connectionId.slice(0, 8)}...`);
    }

    /**
     * Authenticate a connection
     */
    authenticate(connectionId: string, userId: string): boolean {
        const conn = this.connections.get(connectionId);
        if (!conn) return false;

        conn.userId = userId;

        // Track user connections
        if (!this.userConnections.has(userId)) {
            this.userConnections.set(userId, new Set());
        }
        this.userConnections.get(userId)!.add(connectionId);

        console.log(`[WS] Authenticated: ${connectionId.slice(0, 8)}... -> ${userId.slice(0, 20)}...`);
        return true;
    }

    /**
     * Subscribe connection to a channel
     */
    subscribe(connectionId: string, channel: Channel): boolean {
        const conn = this.connections.get(connectionId);
        if (!conn) return false;

        // User-specific channels require authentication
        if (this.isUserChannel(channel) && !conn.userId) {
            this.send(conn.ws, {
                type: "error",
                message: "Authentication required for this channel",
                channel,
            });
            return false;
        }

        conn.channels.add(channel);

        if (!this.channelSubscribers.has(channel)) {
            this.channelSubscribers.set(channel, new Set());
        }
        this.channelSubscribers.get(channel)!.add(connectionId);

        this.send(conn.ws, {
            type: "subscribed",
            channel,
        });

        console.log(`[WS] Subscribed ${connectionId.slice(0, 8)}... to ${channel}`);
        return true;
    }

    /**
     * Unsubscribe connection from a channel
     */
    unsubscribe(connectionId: string, channel: Channel): void {
        const conn = this.connections.get(connectionId);
        if (conn) {
            conn.channels.delete(channel);
        }

        const subscribers = this.channelSubscribers.get(channel);
        if (subscribers) {
            subscribers.delete(connectionId);
            if (subscribers.size === 0) {
                this.channelSubscribers.delete(channel);
            }
        }
    }

    /**
     * Broadcast to all subscribers of a channel
     */
    broadcast(channel: Channel, event: string, data: unknown): void {
        const subscribers = this.channelSubscribers.get(channel);
        if (!subscribers || subscribers.size === 0) return;

        const message: WsOutMessage = {
            type: "event",
            channel,
            event,
            data,
            timestamp: new Date().toISOString(),
        };

        for (const connId of subscribers) {
            const conn = this.connections.get(connId);
            if (conn) {
                this.send(conn.ws, message);
            }
        }
    }

    /**
     * Send to a specific user (all their connections with the channel subscribed)
     */
    sendToUser(userId: string, channel: Channel, event: string, data: unknown): void {
        const userConns = this.userConnections.get(userId);
        if (!userConns || userConns.size === 0) return;

        const message: WsOutMessage = {
            type: "event",
            channel,
            event,
            data,
            timestamp: new Date().toISOString(),
        };

        for (const connId of userConns) {
            const conn = this.connections.get(connId);
            if (conn && conn.channels.has(channel)) {
                this.send(conn.ws, message);
            }
        }
    }

    /**
     * Send a message to a specific connection
     */
    sendTo(connectionId: string, message: WsOutMessage): void {
        const conn = this.connections.get(connectionId);
        if (conn) {
            this.send(conn.ws, message);
        }
    }

    /**
     * Update ping timestamp for connection
     */
    updatePing(connectionId: string): void {
        const conn = this.connections.get(connectionId);
        if (conn) {
            conn.lastPing = Date.now();
        }
    }

    /**
     * Get connection user ID
     */
    getConnectionUserId(connectionId: string): string | undefined {
        return this.connections.get(connectionId)?.userId;
    }

    /**
     * Graceful shutdown
     */
    shutdown(): void {
        this.isShuttingDown = true;

        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }

        // Close all connections
        for (const [_connId, conn] of this.connections) {
            try {
                this.send(conn.ws, {
                    type: "shutdown",
                    message: "Server shutting down",
                });
                conn.ws.close(1001, "Server shutting down");
            } catch {
                // Ignore errors during shutdown
            }
        }

        this.connections.clear();
        this.channelSubscribers.clear();
        this.userConnections.clear();

        console.log("[WS] Manager shut down");
    }

    /**
     * Get stats for monitoring
     */
    getStats(): {
        connections: number;
        authenticatedConnections: number;
        channels: number;
        users: number;
    } {
        let authenticated = 0;
        for (const conn of this.connections.values()) {
            if (conn.userId) authenticated++;
        }

        return {
            connections: this.connections.size,
            authenticatedConnections: authenticated,
            channels: this.channelSubscribers.size,
            users: this.userConnections.size,
        };
    }

    // Private methods

    private send(ws: ServerWebSocket<WsData>, message: WsOutMessage): void {
        try {
            message.timestamp = message.timestamp || new Date().toISOString();
            ws.send(JSON.stringify(message));
        } catch (err) {
            console.error("[WS] Send error:", err);
        }
    }

    private isUserChannel(channel: Channel): boolean {
        return ["positions", "orders", "balance"].includes(channel);
    }

    private checkConnections(): void {
        if (this.isShuttingDown) return;

        const now = Date.now();
        const timeout = 60000; // 1 minute timeout

        for (const [connId, conn] of this.connections) {
            if (now - conn.lastPing > timeout) {
                console.log(`[WS] Connection timed out: ${connId.slice(0, 8)}...`);
                this.removeConnection(connId);
                try {
                    conn.ws.close(1000, "Connection timeout");
                } catch {
                    // Connection may already be closed
                }
            }
        }
    }
}

// Singleton instance
export const wsManager = new WebSocketManager();
