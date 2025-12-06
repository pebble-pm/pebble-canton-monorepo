/**
 * Trade Feed Component
 *
 * Displays recent trades for a market
 */

import { cn } from "@/lib/utils";
import { formatQuantity, formatRelativeTime } from "@/lib/formatters";
import type { TradePublicResponse } from "@/types/api";

interface TradeFeedProps {
    trades: TradePublicResponse[];
    className?: string;
    maxTrades?: number;
}

export function TradeFeed({ trades, className, maxTrades = 20 }: TradeFeedProps) {
    const displayTrades = trades.slice(0, maxTrades);

    if (displayTrades.length === 0) {
        return <div className={cn("text-center py-8 text-muted-foreground text-sm", className)}>No recent trades</div>;
    }

    return (
        <div className={cn("flex flex-col", className)}>
            {/* Header */}
            <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground px-2 py-1 border-b">
                <span>Side</span>
                <span className="text-right">Price</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Time</span>
            </div>

            {/* Trades */}
            <div className="flex flex-col divide-y">
                {displayTrades.map((trade) => (
                    <TradeRow key={trade.tradeId} trade={trade} />
                ))}
            </div>
        </div>
    );
}

interface TradeRowProps {
    trade: TradePublicResponse;
}

function TradeRow({ trade }: TradeRowProps) {
    const price = parseFloat(trade.price);
    const quantity = parseFloat(trade.quantity);
    const isYes = trade.side === "yes";

    return (
        <div className="grid grid-cols-4 gap-2 px-2 py-1.5 text-sm hover:bg-accent/50">
            <span className={cn("font-medium uppercase", isYes ? "text-green-500" : "text-red-500")}>{trade.side}</span>
            <span className="text-right font-mono tabular-nums">{Math.round(price * 100)}¢</span>
            <span className="text-right font-mono tabular-nums">{formatQuantity(quantity)}</span>
            <span className="text-right text-muted-foreground text-xs">{formatRelativeTime(trade.timestamp)}</span>
        </div>
    );
}
