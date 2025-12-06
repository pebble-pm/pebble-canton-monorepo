/**
 * Positions Table Component
 *
 * Displays user's positions with values and redeem actions
 */

import { Link } from "@tanstack/react-router";
import { TrendingUp, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { usePositions, useRedeemPosition } from "@/api/positions";
import { useMarkets } from "@/api/markets";
import { useAuthStore } from "@/stores/auth.store";
import { formatBalance, formatQuantity, formatPnL } from "@/lib/formatters";
import type { PositionWithValueResponse } from "@/types/api";

export function PositionsTable() {
    const { data: positions, isLoading } = usePositions();
    const { data: markets } = useMarkets();

    if (isLoading) {
        return <PositionsTableSkeleton />;
    }

    if (!positions || positions.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <TrendingUp className="h-5 w-5" />
                        Positions
                    </CardTitle>
                    <CardDescription>Your open positions</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                        <TrendingUp className="mb-4 h-12 w-12 opacity-50" />
                        <p className="text-lg font-medium">No positions yet</p>
                        <p className="text-sm">Place orders on markets to build your portfolio</p>
                        <Button asChild className="mt-4">
                            <Link to="/">Browse Markets</Link>
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
    }

    // Get market names for display
    const marketMap = new Map(markets?.map((m) => [m.marketId, m]) ?? []);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Positions ({positions.length})
                </CardTitle>
                <CardDescription>Your open positions across markets</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Market</TableHead>
                            <TableHead>Side</TableHead>
                            <TableHead className="text-right">Quantity</TableHead>
                            <TableHead className="text-right">Avg Cost</TableHead>
                            <TableHead className="text-right">Current Value</TableHead>
                            <TableHead className="text-right">P&L</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {positions.map((position) => (
                            <PositionRow
                                key={position.positionId}
                                position={position}
                                marketQuestion={marketMap.get(position.marketId)?.question ?? position.marketId}
                                marketStatus={marketMap.get(position.marketId)?.status}
                                marketOutcome={marketMap.get(position.marketId)?.outcome}
                            />
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}

interface PositionRowProps {
    position: PositionWithValueResponse;
    marketQuestion: string;
    marketStatus?: "open" | "closed" | "resolved";
    marketOutcome?: boolean;
}

function PositionRow({ position, marketQuestion, marketStatus, marketOutcome }: PositionRowProps) {
    const userId = useAuthStore((state) => state.userId);
    const redeemPosition = useRedeemPosition();

    const pnl = formatPnL(position.unrealizedPnL);
    const isWinningPosition =
        marketStatus === "resolved" &&
        ((position.side === "yes" && marketOutcome === true) || (position.side === "no" && marketOutcome === false));

    const handleRedeem = async () => {
        if (!userId) return;

        try {
            const result = await redeemPosition.mutateAsync({
                partyId: userId,
                marketId: position.marketId,
                side: position.side,
            });
            toast.success(`Redeemed ${formatBalance(result.payout)}`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to redeem position");
        }
    };

    return (
        <TableRow>
            <TableCell>
                <Link to="/markets/$marketId" params={{ marketId: position.marketId }} className="flex items-center gap-1 hover:underline">
                    <span className="max-w-[200px] truncate">{marketQuestion}</span>
                    <ExternalLink className="h-3 w-3 opacity-50" />
                </Link>
            </TableCell>
            <TableCell>
                <Badge
                    variant="outline"
                    className={position.side === "yes" ? "border-green-500/50 text-green-500" : "border-red-500/50 text-red-500"}
                >
                    {position.side.toUpperCase()}
                </Badge>
            </TableCell>
            <TableCell className="text-right font-mono">{formatQuantity(position.quantity)}</TableCell>
            <TableCell className="text-right font-mono">{formatBalance(position.avgCostBasis)}</TableCell>
            <TableCell className="text-right font-mono">{formatBalance(position.currentValue)}</TableCell>
            <TableCell className={`text-right font-mono ${pnl.className}`}>{pnl.text}</TableCell>
            <TableCell className="text-right">
                {isWinningPosition && (
                    <Button variant="default" size="sm" onClick={handleRedeem} disabled={redeemPosition.isPending}>
                        {redeemPosition.isPending ? "Redeeming..." : "Redeem"}
                    </Button>
                )}
                {marketStatus === "resolved" && !isWinningPosition && <Badge variant="secondary">Lost</Badge>}
            </TableCell>
        </TableRow>
    );
}

function PositionsTableSkeleton() {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Positions
                </CardTitle>
                <CardDescription>Your open positions</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="flex items-center gap-4">
                            <Skeleton className="h-4 w-48" />
                            <Skeleton className="h-4 w-16" />
                            <Skeleton className="h-4 w-20" />
                            <Skeleton className="h-4 w-20" />
                            <Skeleton className="h-4 w-20" />
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
