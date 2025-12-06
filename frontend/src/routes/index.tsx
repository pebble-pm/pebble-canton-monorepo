/**
 * Markets List Page (Home)
 *
 * Displays all available prediction markets
 */

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MarketCard } from "@/components/market/market-card";
import { useMarkets } from "@/api/markets";

export const Route = createFileRoute("/")({
    component: MarketsPage,
});

type MarketStatus = "all" | "open" | "closed" | "resolved";

function MarketsPage() {
    const [statusFilter, setStatusFilter] = useState<MarketStatus>("all");

    const { data: markets, isLoading, error } = useMarkets(statusFilter === "all" ? undefined : statusFilter);

    return (
        <div className="container mx-auto p-6">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-2">
                        <TrendingUp className="h-8 w-8" />
                        Markets
                    </h1>
                    <p className="text-muted-foreground">Browse and trade on prediction markets</p>
                </div>

                {/* Filter */}
                <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Status:</span>
                    <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as MarketStatus)}>
                        <SelectTrigger className="w-32">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="open">Open</SelectItem>
                            <SelectItem value="closed">Closed</SelectItem>
                            <SelectItem value="resolved">Resolved</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Markets list */}
            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : error ? (
                <div className="text-center py-12">
                    <p className="text-destructive mb-4">Failed to load markets: {error.message}</p>
                    <Button variant="outline" onClick={() => window.location.reload()}>
                        Retry
                    </Button>
                </div>
            ) : !markets || markets.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                    <p className="mb-2">No markets found</p>
                    <p className="text-sm">
                        {statusFilter !== "all" ? "Try changing the status filter" : "Check back later for new markets"}
                    </p>
                </div>
            ) : (
                <div className="grid gap-4">
                    {markets.map((market) => (
                        <MarketCard key={market.marketId} market={market} />
                    ))}
                </div>
            )}
        </div>
    );
}
