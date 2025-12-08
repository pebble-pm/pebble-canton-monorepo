/**
 * Price Badge Component
 *
 * Displays YES/NO prices with color coding
 */

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface PriceBadgeProps {
    side: "yes" | "no";
    price: string | number;
    size?: "sm" | "md" | "lg";
    showLabel?: boolean;
    className?: string;
}

export function PriceBadge({ side, price, size = "md", showLabel = true, className }: PriceBadgeProps) {
    const numPrice = typeof price === "string" ? parseFloat(price) : price;
    const displayPrice = `${Math.round(numPrice * 100)}¢`;

    const sizeClasses = {
        sm: "text-xs px-1.5 py-0.5",
        md: "text-sm px-2 py-1",
        lg: "text-base px-3 py-1.5",
    };

    return (
        <Badge
            variant="outline"
            className={cn(
                "font-mono tabular-nums",
                sizeClasses[size],
                side === "yes"
                    ? "border-green-500/50 bg-green-500/10 text-green-500"
                    : "border-red-500/50 bg-red-500/10 text-red-500",
                className,
            )}
        >
            {showLabel && <span className="mr-1 font-medium uppercase">{side}</span>}
            {displayPrice}
        </Badge>
    );
}

interface PricePairProps {
    yesPrice: string | number;
    noPrice: string | number;
    size?: "sm" | "md" | "lg";
    className?: string;
}

/**
 * Display both YES and NO prices together
 */
export function PricePair({ yesPrice, noPrice, size = "md", className }: PricePairProps) {
    return (
        <div className={cn("flex items-center gap-2", className)}>
            <PriceBadge side="yes" price={yesPrice} size={size} />
            <PriceBadge side="no" price={noPrice} size={size} />
        </div>
    );
}
