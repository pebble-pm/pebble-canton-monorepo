/**
 * Market Card Component
 *
 * Displays a single market in the markets list
 */

import { Link } from "@tanstack/react-router";
import { Calendar, TrendingUp } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PricePair } from "./price-badge";
import { formatVolume } from "@/lib/formatters";
import type { MarketResponse } from "@/types/api";

interface MarketCardProps {
    market: MarketResponse;
}

export function MarketCard({ market }: MarketCardProps) {
    const resolutionDate = new Date(market.resolutionTime);
    const isResolved = market.status === "resolved";
    const isClosed = market.status === "closed";

    return (
        <Link to="/markets/$marketId" params={{ marketId: market.marketId }} className="block">
            <Card className="transition-colors hover:bg-accent/50">
                <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-lg leading-tight">{market.question}</CardTitle>
                        <StatusBadge status={market.status} outcome={market.outcome} />
                    </div>
                    {market.description && <CardDescription className="line-clamp-2">{market.description}</CardDescription>}
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        {/* Prices */}
                        <div>
                            {isResolved ? (
                                <div className="text-sm">
                                    <span className="text-muted-foreground">Resolved: </span>
                                    <span className={market.outcome ? "text-green-500 font-medium" : "text-red-500 font-medium"}>
                                        {market.outcome ? "YES" : "NO"}
                                    </span>
                                </div>
                            ) : (
                                <PricePair yesPrice={market.yesPrice} noPrice={market.noPrice} size="md" />
                            )}
                        </div>

                        {/* Stats */}
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1">
                                <TrendingUp className="h-4 w-4" />
                                <span>{formatVolume(market.totalVolume)}</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <Calendar className="h-4 w-4" />
                                <span>
                                    {isResolved || isClosed
                                        ? format(resolutionDate, "MMM d, yyyy")
                                        : formatDistanceToNow(resolutionDate, {
                                              addSuffix: true,
                                          })}
                                </span>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}

function StatusBadge({ status, outcome }: { status: MarketResponse["status"]; outcome?: boolean }) {
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
            {outcome ? "YES" : "NO"}
        </Badge>
    );
}
