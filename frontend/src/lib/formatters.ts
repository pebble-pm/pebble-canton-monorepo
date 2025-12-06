/**
 * Formatting utilities for displaying values
 */

/**
 * Format a price value as currency
 */
export function formatPrice(value: string | number): string {
    const num = typeof value === "string" ? Number.parseFloat(value) : value;
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(num);
}

/**
 * Format a balance as currency
 */
export function formatBalance(value: string | number): string {
    const num = typeof value === "string" ? Number.parseFloat(value) : value;
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(num);
}

/**
 * Format volume with K/M suffixes
 */
export function formatVolume(value: string | number): string {
    const num = typeof value === "string" ? Number.parseFloat(value) : value;
    if (num >= 1_000_000) {
        return `$${(num / 1_000_000).toFixed(1)}M`;
    }
    if (num >= 1_000) {
        return `$${(num / 1_000).toFixed(1)}K`;
    }
    return formatPrice(num);
}

/**
 * Format a quantity with optional decimals
 */
export function formatQuantity(value: string | number): string {
    const num = typeof value === "string" ? Number.parseFloat(value) : value;
    return new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(num);
}

/**
 * Format a date as short date (e.g., "Dec 4, 2025")
 */
export function formatDate(value: string | Date): string {
    const date = typeof value === "string" ? new Date(value) : value;
    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(date);
}

/**
 * Format a date with time (e.g., "Dec 4, 10:30 AM")
 */
export function formatDateTime(value: string | Date): string {
    const date = typeof value === "string" ? new Date(value) : value;
    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(date);
}

/**
 * Format a date as relative time (e.g., "5m ago", "2h ago")
 */
export function formatRelativeTime(value: string | Date): string {
    const date = typeof value === "string" ? new Date(value) : value;
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(date);
}

/**
 * Format a percentage (e.g., 0.65 -> "65%")
 */
export function formatPercent(value: string | number): string {
    const num = typeof value === "string" ? Number.parseFloat(value) : value;
    return `${(num * 100).toFixed(0)}%`;
}

/**
 * Format P&L with sign and color class
 */
export function formatPnL(value: string | number): {
    text: string;
    className: string;
} {
    const num = typeof value === "string" ? Number.parseFloat(value) : value;
    const formatted = formatBalance(Math.abs(num));

    if (num > 0) {
        return { text: `+${formatted}`, className: "text-green-500" };
    }
    if (num < 0) {
        return { text: `-${formatted}`, className: "text-red-500" };
    }
    return { text: formatted, className: "text-muted-foreground" };
}
