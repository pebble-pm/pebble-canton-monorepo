/**
 * Market Header Component
 *
 * Displays market title, status, and key stats
 */

import { Calendar, Clock, TrendingUp } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { PricePair } from "./price-badge";
import { formatVolume } from "@/lib/formatters";
import type { MarketDetailResponse } from "@/types/api";

interface MarketHeaderProps {
    market: MarketDetailResponse;
}

export function MarketHeader({ market }: MarketHeaderProps) {
    const resolutionDate = new Date(market.resolutionTime);
    const isResolved = market.status === "resolved";
    const isClosed = market.status === "closed";
    const isOpen = market.status === "open";

    return (
        <div className="space-y-4">
            {/* Title and status */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <StatusBadge status={market.status} outcome={market.outcome} />
                        <h1 className="text-2xl font-bold">{market.question}</h1>
                    </div>
                    {market.description && <p className="text-muted-foreground max-w-2xl">{market.description}</p>}
                </div>

                {/* Current prices */}
                {!isResolved && (
                    <div className="flex flex-col items-end gap-1">
                        <span className="text-xs text-muted-foreground">Current Prices</span>
                        <PricePair yesPrice={market.yesPrice} noPrice={market.noPrice} size="lg" />
                    </div>
                )}

                {/* Resolved outcome */}
                {isResolved && (
                    <div className="flex flex-col items-end gap-1">
                        <span className="text-xs text-muted-foreground">Outcome</span>
                        <Badge
                            variant="outline"
                            className={`text-lg px-4 py-1 ${
                                market.outcome ? "border-green-500 text-green-500" : "border-red-500 text-red-500"
                            }`}
                        >
                            {market.outcome ? "YES" : "NO"}
                        </Badge>
                    </div>
                )}
            </div>

            {/* Stats bar */}
            <div className="flex flex-wrap items-center gap-6 text-sm">
                <StatItem icon={TrendingUp} label="Volume" value={formatVolume(market.totalVolume)} />
                <StatItem
                    icon={Calendar}
                    label={isResolved ? "Resolved" : isClosed ? "Closed" : "Resolves"}
                    value={
                        isResolved || isClosed
                            ? format(resolutionDate, "MMM d, yyyy")
                            : formatDistanceToNow(resolutionDate, {
                                  addSuffix: true,
                              })
                    }
                />
                {isOpen && <StatItem icon={Clock} label="24h Volume" value={formatVolume(market.volume24h)} />}
            </div>
        </div>
    );
}

interface StatItemProps {
    icon: React.ElementType;
    label: string;
    value: string;
}

function StatItem({ icon: Icon, label, value }: StatItemProps) {
    return (
        <div className="flex items-center gap-2 text-muted-foreground">
            <Icon className="h-4 w-4" />
            <span>{label}:</span>
            <span className="font-medium text-foreground">{value}</span>
        </div>
    );
}

function StatusBadge({ status, outcome }: { status: "open" | "closed" | "resolved"; outcome?: boolean }) {
    if (status === "open") {
        return (
            <Badge variant="default" className="bg-green-600">
                Open
            </Badge>
        );
    }

    if (status === "closed") {
        return <Badge variant="secondary">Closed</Badge>;
    }

    // Resolved
    return (
        <Badge variant="outline" className={outcome ? "border-green-500 text-green-500" : "border-red-500 text-red-500"}>
            Resolved
        </Badge>
    );
}
