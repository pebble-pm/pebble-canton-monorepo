/**
 * Authentication Store
 *
 * Manages user authentication state with localStorage persistence
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AuthUser {
    userId: string;
    partyId: string;
    displayName: string;
}

interface AuthState {
    // State
    userId: string | null;
    partyId: string | null;
    displayName: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;

    // Actions
    login: (user: AuthUser) => void;
    logout: () => void;
    setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            // Initial state
            userId: null,
            partyId: null,
            displayName: null,
            isAuthenticated: false,
            isLoading: false,

            // Login action
            login: (user: AuthUser) => {
                set({
                    userId: user.userId,
                    partyId: user.partyId,
                    displayName: user.displayName,
                    isAuthenticated: true,
                    isLoading: false,
                });
            },

            // Logout action
            logout: () => {
                set({
                    userId: null,
                    partyId: null,
                    displayName: null,
                    isAuthenticated: false,
                    isLoading: false,
                });
            },

            // Set loading state
            setLoading: (loading: boolean) => {
                set({ isLoading: loading });
            },
        }),
        {
            name: "pebble-auth",
            // Only persist auth-related fields
            partialize: (state) => ({
                userId: state.userId,
                partyId: state.partyId,
                displayName: state.displayName,
                isAuthenticated: state.isAuthenticated,
            }),
        },
    ),
);

/**
 * Create a simple JWT-like token for WebSocket authentication
 * Note: This is for MVP only - production should use proper JWTs
 */
export function createAuthToken(userId: string): string {
    const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }));
    const payload = btoa(
        JSON.stringify({
            sub: userId,
            iat: Math.floor(Date.now() / 1000),
        }),
    );
    return `${header}.${payload}.`;
}

/**
 * Selector to check if current user is admin
 * Admin is identified by partyId starting with "PebbleAdmin"
 */
export function useIsAdmin(): boolean {
    return useAuthStore((state) => state.isAuthenticated && state.partyId?.startsWith("PebbleAdmin") === true);
}

/**
 * Helper for route protection - checks localStorage directly
 * Used in beforeLoad guards where hooks cannot be used
 */
export function getIsAdminFromStorage(): boolean {
    try {
        const stored = localStorage.getItem("pebble-auth");
        if (stored) {
            const parsed = JSON.parse(stored);
            const partyId = parsed.state?.partyId;
            return parsed.state?.isAuthenticated && typeof partyId === "string" && partyId.startsWith("PebbleAdmin");
        }
    } catch {
        // Ignore parse errors
    }
    return false;
}
