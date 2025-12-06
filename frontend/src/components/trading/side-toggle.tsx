/**
 * Side Toggle Component
 *
 * Toggle between YES and NO sides for trading
 */

import { cn } from "@/lib/utils";
import type { OrderSide } from "@/types/api";

interface SideToggleProps {
    value: OrderSide;
    onChange: (side: OrderSide) => void;
    disabled?: boolean;
    className?: string;
}

export function SideToggle({ value, onChange, disabled = false, className }: SideToggleProps) {
    return (
        <div className={cn("grid grid-cols-2 gap-1 p-1 bg-muted rounded-lg", className)}>
            <button
                type="button"
                onClick={() => onChange("yes")}
                disabled={disabled}
                className={cn(
                    "px-4 py-2 text-sm font-medium rounded-md transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                    value === "yes"
                        ? "bg-green-600 text-white shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-background/50",
                    disabled && "opacity-50 cursor-not-allowed",
                )}
            >
                YES
            </button>
            <button
                type="button"
                onClick={() => onChange("no")}
                disabled={disabled}
                className={cn(
                    "px-4 py-2 text-sm font-medium rounded-md transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                    value === "no"
                        ? "bg-red-600 text-white shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-background/50",
                    disabled && "opacity-50 cursor-not-allowed",
                )}
            >
                NO
            </button>
        </div>
    );
}
