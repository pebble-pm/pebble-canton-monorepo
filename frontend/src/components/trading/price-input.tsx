/**
 * Price Input Component
 *
 * Input for price with validation (0.01 - 0.99)
 */

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { MIN_PRICE, MAX_PRICE } from "@/lib/constants";

interface PriceInputProps {
    value: number;
    onChange: (value: number) => void;
    disabled?: boolean;
    label?: string;
    showSlider?: boolean;
    className?: string;
}

export function PriceInput({
    value,
    onChange,
    disabled = false,
    label = "Price",
    showSlider = true,
    className,
}: PriceInputProps) {
    // Convert price (0.01-0.99) to cents display (1-99)
    const centsValue = Math.round(value * 100);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const cents = parseInt(e.target.value, 10);
        if (!isNaN(cents)) {
            const clamped = Math.min(Math.max(cents, 1), 99);
            onChange(clamped / 100);
        }
    };

    const handleSliderChange = (values: number[]) => {
        onChange(values[0] / 100);
    };

    return (
        <div className={cn("space-y-2", className)}>
            <div className="flex items-center justify-between">
                <Label htmlFor="price-input">{label}</Label>
                <div className="flex items-center gap-1">
                    <Input
                        id="price-input"
                        type="number"
                        min={1}
                        max={99}
                        value={centsValue}
                        onChange={handleInputChange}
                        disabled={disabled}
                        className="w-16 h-8 text-right font-mono"
                    />
                    <span className="text-sm text-muted-foreground">¢</span>
                </div>
            </div>

            {showSlider && (
                <Slider
                    value={[centsValue]}
                    onValueChange={handleSliderChange}
                    min={Math.round(MIN_PRICE * 100)}
                    max={Math.round(MAX_PRICE * 100)}
                    step={1}
                    disabled={disabled}
                    className="py-2"
                />
            )}

            <div className="flex justify-between text-xs text-muted-foreground">
                <span>1¢</span>
                <span>50¢</span>
                <span>99¢</span>
            </div>
        </div>
    );
}
