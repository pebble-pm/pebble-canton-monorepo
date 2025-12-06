/**
 * WebSocket Client
 *
 * Manages WebSocket connection with auto-reconnection
 */

import type { WsInboundMessage, WsOutboundEvent } from "@/types/api";

export type WsChannel = `orderbook:${string}` | `trades:${string}` | "positions" | "orders" | "balance";

export type WsEventHandler = (event: WsOutboundEvent) => void;

interface WsClientOptions {
    url: string;
    onConnect?: () => void;
    onDisconnect?: () => void;
    onError?: (error: Event) => void;
    onMessage?: WsEventHandler;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
}

export class WsClient {
    private ws: WebSocket | null = null;
    private options: Required<WsClientOptions>;
    private reconnectAttempts = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private subscribedChannels = new Set<WsChannel>();
    private authenticated = false;
    private userId: string | null = null;
    private pingInterval: ReturnType<typeof setInterval> | null = null;

    constructor(options: WsClientOptions) {
        this.options = {
            reconnectInterval: 3000,
            maxReconnectAttempts: 10,
            onConnect: () => {},
            onDisconnect: () => {},
            onError: () => {},
            onMessage: () => {},
            ...options,
        };
    }

    connect(): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            return;
        }

        try {
            this.ws = new WebSocket(this.options.url);
            this.setupEventHandlers();
        } catch (error) {
            console.error("[WS] Failed to create WebSocket:", error);
            this.scheduleReconnect();
        }
    }

    disconnect(): void {
        this.stopPing();
        this.clearReconnectTimer();
        this.authenticated = false;
        this.subscribedChannels.clear();

        if (this.ws) {
            this.ws.close(1000, "Client disconnect");
            this.ws = null;
        }
    }

    isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    isAuthenticated(): boolean {
        return this.authenticated;
    }

    /**
     * Authenticate with the server
     * Creates a simple token from userId
     */
    authenticate(userId: string): void {
        this.userId = userId;

        if (!this.isConnected()) {
            return;
        }

        // Create simple JWT-like token (base64 encoded payload)
        const payload = JSON.stringify({ sub: userId, iat: Date.now() });
        const token = btoa(payload);

        this.send({ type: "auth", token });
    }

    /**
     * Subscribe to a channel
     */
    subscribe(channel: WsChannel): void {
        this.subscribedChannels.add(channel);

        if (this.isConnected() && this.authenticated) {
            this.send({ type: "subscribe", channel });
        }
    }

    /**
     * Unsubscribe from a channel
     */
    unsubscribe(channel: WsChannel): void {
        this.subscribedChannels.delete(channel);

        if (this.isConnected()) {
            this.send({ type: "unsubscribe", channel });
        }
    }

    /**
     * Subscribe to multiple channels
     */
    subscribeMany(channels: WsChannel[]): void {
        channels.forEach((c) => this.subscribedChannels.add(c));

        if (this.isConnected() && this.authenticated) {
            this.send({ type: "subscribe", channels });
        }
    }

    private setupEventHandlers(): void {
        if (!this.ws) return;

        this.ws.onopen = () => {
            console.log("[WS] Connected");
            this.reconnectAttempts = 0;
            this.options.onConnect();
            this.startPing();

            // Re-authenticate if we have a userId
            if (this.userId) {
                this.authenticate(this.userId);
            }
        };

        this.ws.onclose = (event) => {
            console.log("[WS] Disconnected:", event.code, event.reason);
            this.stopPing();
            this.authenticated = false;
            this.options.onDisconnect();

            // Don't reconnect if closed normally
            if (event.code !== 1000) {
                this.scheduleReconnect();
            }
        };

        this.ws.onerror = (error) => {
            console.error("[WS] Error:", error);
            this.options.onError(error);
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data) as WsOutboundEvent;
                this.handleMessage(data);
            } catch (error) {
                console.error("[WS] Failed to parse message:", error);
            }
        };
    }

    private handleMessage(event: WsOutboundEvent): void {
        switch (event.type) {
            case "authenticated":
                console.log("[WS] Authenticated");
                this.authenticated = true;
                // Re-subscribe to channels after auth
                this.resubscribeAll();
                break;

            case "subscribed":
                console.log("[WS] Subscribed to:", event.channel);
                break;

            case "unsubscribed":
                console.log("[WS] Unsubscribed from:", event.channel);
                break;

            case "pong":
                // Server responded to ping
                break;

            case "error":
                console.error("[WS] Server error:", event.error);
                break;

            default:
                // Forward all other events to handler
                this.options.onMessage(event);
        }
    }

    private resubscribeAll(): void {
        if (this.subscribedChannels.size > 0) {
            const channels = Array.from(this.subscribedChannels);
            this.send({ type: "subscribe", channels });
        }
    }

    private send(message: WsInboundMessage): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
            console.error("[WS] Max reconnect attempts reached");
            return;
        }

        this.clearReconnectTimer();
        this.reconnectAttempts++;

        const delay = this.options.reconnectInterval * Math.min(this.reconnectAttempts, 5);
        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, delay);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private startPing(): void {
        this.stopPing();
        this.pingInterval = setInterval(() => {
            if (this.isConnected()) {
                this.send({ type: "ping" });
            }
        }, 30000);
    }

    private stopPing(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }
}

// Singleton instance
let wsClient: WsClient | null = null;

export function getWsClient(): WsClient {
    if (!wsClient) {
        // Use relative URL for WebSocket
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}/ws`;

        wsClient = new WsClient({ url: wsUrl });
    }
    return wsClient;
}

export function createWsClient(options: WsClientOptions): WsClient {
    return new WsClient(options);
}
