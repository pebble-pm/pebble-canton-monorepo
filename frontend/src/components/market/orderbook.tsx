/**
 * Orderbook Component
 *
 * Displays L2 orderbook with bids and asks
 */

import { cn } from "@/lib/utils";
import { formatQuantity } from "@/lib/formatters";
import type { OrderBookResponse, OrderBookLevelResponse } from "@/types/api";

interface OrderbookProps {
    orderbook: OrderBookResponse;
    side: "yes" | "no";
    className?: string;
}

export function Orderbook({ orderbook, side, className }: OrderbookProps) {
    const book = side === "yes" ? orderbook.yes : orderbook.no;
    const { bids, asks } = book;

    // Calculate max quantity for bar width scaling
    const allLevels = [...bids, ...asks];
    const maxQty = Math.max(...allLevels.map((l) => parseFloat(l.quantity)), 1);

    return (
        <div className={cn("flex flex-col", className)}>
            {/* Header */}
            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground px-2 py-1 border-b">
                <span>Price</span>
                <span className="text-center">Qty</span>
                <span className="text-right">Total</span>
            </div>

            {/* Asks (sell orders) - reversed to show lowest ask at bottom */}
            <div className="flex flex-col-reverse">
                {asks.slice(0, 8).map((level, i) => (
                    <OrderbookRow key={`ask-${i}`} level={level} type="ask" maxQty={maxQty} />
                ))}
            </div>

            {/* Spread indicator */}
            <div className="px-2 py-1 text-center text-xs text-muted-foreground border-y bg-muted/30">{getSpread(bids, asks)}</div>

            {/* Bids (buy orders) */}
            <div className="flex flex-col">
                {bids.slice(0, 8).map((level, i) => (
                    <OrderbookRow key={`bid-${i}`} level={level} type="bid" maxQty={maxQty} />
                ))}
            </div>
        </div>
    );
}

interface OrderbookRowProps {
    level: OrderBookLevelResponse;
    type: "bid" | "ask";
    maxQty: number;
}

function OrderbookRow({ level, type, maxQty }: OrderbookRowProps) {
    const price = parseFloat(level.price);
    const quantity = parseFloat(level.quantity);
    const barWidth = (quantity / maxQty) * 100;

    return (
        <div className="relative px-2 py-0.5 hover:bg-accent/50 text-sm">
            {/* Background bar */}
            <div
                className={cn("absolute inset-y-0 right-0 opacity-20", type === "bid" ? "bg-green-500" : "bg-red-500")}
                style={{ width: `${barWidth}%` }}
            />

            {/* Content */}
            <div className="relative grid grid-cols-3 gap-2 font-mono tabular-nums">
                <span className={cn(type === "bid" ? "text-green-500" : "text-red-500")}>{Math.round(price * 100)}¢</span>
                <span className="text-center">{formatQuantity(quantity)}</span>
                <span className="text-right text-muted-foreground">{level.orderCount}</span>
            </div>
        </div>
    );
}

function getSpread(bids: OrderBookLevelResponse[], asks: OrderBookLevelResponse[]): string {
    if (bids.length === 0 || asks.length === 0) {
        return "No spread";
    }

    const bestBid = parseFloat(bids[0].price);
    const bestAsk = parseFloat(asks[0].price);
    const spread = bestAsk - bestBid;

    if (spread <= 0) {
        return "Crossed";
    }

    return `Spread: ${Math.round(spread * 100)}¢`;
}

/**
 * Combined orderbook showing both YES and NO sides
 */
interface DualOrderbookProps {
    orderbook: OrderBookResponse;
    className?: string;
}

export function DualOrderbook({ orderbook, className }: DualOrderbookProps) {
    return (
        <div className={cn("grid grid-cols-2 gap-4", className)}>
            <div className="border rounded-lg overflow-hidden">
                <div className="bg-muted px-3 py-2 text-sm font-medium border-b">YES Orderbook</div>
                <Orderbook orderbook={orderbook} side="yes" />
            </div>
            <div className="border rounded-lg overflow-hidden">
                <div className="bg-muted px-3 py-2 text-sm font-medium border-b">NO Orderbook</div>
                <Orderbook orderbook={orderbook} side="no" />
            </div>
        </div>
    );
}
