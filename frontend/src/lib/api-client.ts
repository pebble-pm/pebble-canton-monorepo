/**
 * API Client for Pebble Backend
 *
 * Fetch wrapper with automatic auth header injection
 */

import { API_BASE } from "./constants";

/** Get auth store state without importing the store (breaks circular deps) */
function getAuthUserId(): string | null {
    try {
        const stored = localStorage.getItem("pebble-auth");
        if (stored) {
            const parsed = JSON.parse(stored);
            return parsed.state?.userId ?? null;
        }
    } catch {
        // Ignore parse errors
    }
    return null;
}

/** API error with typed response */
export class ApiError extends Error {
    status: number;
    code?: string;
    details?: Record<string, unknown>;

    constructor(message: string, status: number, code?: string, details?: Record<string, unknown>) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

/** Standard API response wrapper */
export interface ApiResponse<T> {
    data: T;
    total?: number;
    page?: number;
    pageSize?: number;
    hasMore?: boolean;
}

/**
 * Make an authenticated API request
 *
 * @param endpoint - API endpoint (without /api prefix)
 * @param options - Fetch options
 * @returns Parsed JSON response
 */
export async function apiClient<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const userId = getAuthUserId();

    const headers: HeadersInit = {
        "Content-Type": "application/json",
        ...options.headers,
    };

    // Add auth header if user is logged in
    if (userId) {
        (headers as Record<string, string>)["X-User-Id"] = userId;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
    });

    // Handle non-JSON responses
    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
        if (!response.ok) {
            throw new ApiError(`Request failed: ${response.statusText}`, response.status);
        }
        return {} as T;
    }

    const data = await response.json();

    if (!response.ok) {
        throw new ApiError(data.error || "Request failed", response.status, data.code, data.details);
    }

    return data;
}

/**
 * GET request helper
 */
export function apiGet<T>(endpoint: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    let url = endpoint;
    if (params) {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined) {
                searchParams.set(key, String(value));
            }
        });
        const queryString = searchParams.toString();
        if (queryString) {
            url += `?${queryString}`;
        }
    }
    return apiClient<T>(url, { method: "GET" });
}

/**
 * POST request helper
 */
export function apiPost<T>(endpoint: string, body?: unknown): Promise<T> {
    return apiClient<T>(endpoint, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
    });
}

/**
 * DELETE request helper
 */
export function apiDelete<T>(endpoint: string): Promise<T> {
    return apiClient<T>(endpoint, { method: "DELETE" });
}
