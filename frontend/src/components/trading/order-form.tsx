/**
 * Order Form Component
 *
 * Form for placing buy/sell orders
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { SideToggle } from "./side-toggle";
import { PriceInput } from "./price-input";
import { useAuthStore } from "@/stores/auth.store";
import { useAccount } from "@/api/account";
import { usePlaceOrder } from "@/api/orders";
import { formatBalance } from "@/lib/formatters";
import { MIN_PRICE, MAX_PRICE } from "@/lib/constants";
import type { OrderSide, OrderAction } from "@/types/api";
import { toast } from "sonner";

// Form schema
const orderSchema = z.object({
    side: z.enum(["yes", "no"]),
    action: z.enum(["buy", "sell"]),
    price: z.number().min(MIN_PRICE).max(MAX_PRICE),
    quantity: z.number().positive().int(),
});

type OrderFormData = z.infer<typeof orderSchema>;

interface OrderFormProps {
    marketId: string;
    yesPrice?: number;
    noPrice?: number;
}

export function OrderForm({ marketId, yesPrice = 0.5, noPrice = 0.5 }: OrderFormProps) {
    const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
    const { data: account } = useAccount();
    const placeOrder = usePlaceOrder();

    const [action, setAction] = useState<OrderAction>("buy");
    const [side, setSide] = useState<OrderSide>("yes");

    const form = useForm<OrderFormData>({
        resolver: zodResolver(orderSchema),
        defaultValues: {
            side: "yes",
            action: "buy",
            price: yesPrice,
            quantity: 10,
        },
    });

    const price = form.watch("price");
    const quantity = form.watch("quantity");

    // Calculate estimated cost
    const estimatedCost = price * quantity;
    const availableBalance = account ? parseFloat(account.availableBalance) : 0;
    const canAfford = estimatedCost <= availableBalance;

    const handleSideChange = (newSide: OrderSide) => {
        setSide(newSide);
        form.setValue("side", newSide);
        // Update price to match side
        form.setValue("price", newSide === "yes" ? yesPrice : noPrice);
    };

    const handleActionChange = (newAction: string) => {
        setAction(newAction as OrderAction);
        form.setValue("action", newAction as OrderAction);
    };

    const onSubmit = async (data: OrderFormData) => {
        try {
            await placeOrder.mutateAsync({
                marketId,
                side: data.side,
                action: data.action,
                orderType: "limit",
                price: data.price,
                quantity: data.quantity,
            });
            toast.success("Order placed successfully");
            // Reset quantity after successful order
            form.setValue("quantity", 10);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to place order");
        }
    };

    // Not authenticated - show login prompt
    if (!isAuthenticated) {
        return (
            <div className="text-center py-8 space-y-4">
                <p className="text-muted-foreground">Login to start trading</p>
                <Button asChild>
                    <Link to="/login">Login</Link>
                </Button>
            </div>
        );
    }

    return (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Buy/Sell Tabs */}
            <Tabs value={action} onValueChange={handleActionChange}>
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger
                        value="buy"
                        className="data-[state=active]:bg-green-600 data-[state=active]:text-white"
                    >
                        Buy
                    </TabsTrigger>
                    <TabsTrigger value="sell" className="data-[state=active]:bg-red-600 data-[state=active]:text-white">
                        Sell
                    </TabsTrigger>
                </TabsList>
            </Tabs>

            {/* YES/NO Toggle */}
            <div className="space-y-2">
                <Label>Outcome</Label>
                <SideToggle value={side} onChange={handleSideChange} disabled={placeOrder.isPending} />
            </div>

            {/* Price Input */}
            <PriceInput
                value={price}
                onChange={(v) => form.setValue("price", v)}
                disabled={placeOrder.isPending}
                label="Limit Price"
            />

            {/* Quantity Input */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label htmlFor="quantity">Shares</Label>
                    <div className="flex gap-1">
                        {[10, 50, 100].map((q) => (
                            <Button
                                key={q}
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() => form.setValue("quantity", q)}
                                disabled={placeOrder.isPending}
                            >
                                {q}
                            </Button>
                        ))}
                    </div>
                </div>
                <Input
                    id="quantity"
                    type="number"
                    min={1}
                    {...form.register("quantity", { valueAsNumber: true })}
                    disabled={placeOrder.isPending}
                    className="font-mono"
                />
                {form.formState.errors.quantity && (
                    <p className="text-xs text-destructive">{form.formState.errors.quantity.message}</p>
                )}
            </div>

            <Separator />

            {/* Order Summary */}
            <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                    <span className="text-muted-foreground">{action === "buy" ? "Est. Cost" : "Est. Proceeds"}</span>
                    <span className="font-mono font-medium">{formatBalance(estimatedCost)}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Available</span>
                    <span className="font-mono">{formatBalance(availableBalance)}</span>
                </div>
                {action === "buy" && !canAfford && <p className="text-xs text-destructive">Insufficient balance</p>}
            </div>

            {/* Submit Button */}
            <Button
                type="submit"
                className={`w-full ${action === "buy" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}`}
                disabled={placeOrder.isPending || (action === "buy" && !canAfford)}
            >
                {placeOrder.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {action === "buy" ? "Buy" : "Sell"} {side.toUpperCase()}
            </Button>
        </form>
    );
}
