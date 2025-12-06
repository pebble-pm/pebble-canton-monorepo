/**
 * Market Management
 *
 * List of markets with admin actions (close, resolve)
 */

import { Link } from "@tanstack/react-router";
import { ExternalLink, Lock, CheckCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useMarkets } from "@/api/markets";
import { CreateMarketDialog } from "./create-market-dialog";
import { CloseMarketButton } from "./close-market-button";
import { ResolveMarketDialog } from "./resolve-market-dialog";
import { formatVolume, formatDate } from "@/lib/formatters";

export function MarketManagement() {
    const { data: markets, isLoading } = useMarkets();

    if (isLoading) {
        return <MarketManagementSkeleton />;
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>Market Management</CardTitle>
                    <CardDescription>Create, close, and resolve prediction markets</CardDescription>
                </div>
                <CreateMarketDialog />
            </CardHeader>
            <CardContent>
                {!markets || markets.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">No markets yet. Create your first market to get started.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Question</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Volume</TableHead>
                                    <TableHead>Resolution</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {markets.map((market) => (
                                    <TableRow key={market.marketId}>
                                        <TableCell>
                                            <Link
                                                to="/markets/$marketId"
                                                params={{ marketId: market.marketId }}
                                                className="flex items-center gap-1 hover:underline max-w-[300px]"
                                            >
                                                <span className="truncate">{market.question}</span>
                                                <ExternalLink className="h-3 w-3 opacity-50 flex-shrink-0" />
                                            </Link>
                                        </TableCell>
                                        <TableCell>
                                            <StatusBadge status={market.status} outcome={market.outcome} />
                                        </TableCell>
                                        <TableCell className="text-right font-mono">{formatVolume(market.totalVolume)}</TableCell>
                                        <TableCell>{formatDate(market.resolutionTime)}</TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                {market.status === "open" && <CloseMarketButton marketId={market.marketId} />}
                                                {(market.status === "open" || market.status === "closed") && (
                                                    <ResolveMarketDialog marketId={market.marketId} question={market.question} />
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function StatusBadge({ status, outcome }: { status: string; outcome?: boolean }) {
    if (status === "open") {
        return <Badge variant="default">Open</Badge>;
    }
    if (status === "closed") {
        return (
            <Badge variant="secondary">
                <Lock className="mr-1 h-3 w-3" />
                Closed
            </Badge>
        );
    }
    if (status === "resolved") {
        return (
            <Badge variant={outcome ? "default" : "destructive"}>
                <CheckCircle className="mr-1 h-3 w-3" />
                {outcome ? "YES" : "NO"}
            </Badge>
        );
    }
    return <Badge variant="outline">{status}</Badge>;
}

function MarketManagementSkeleton() {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>Market Management</CardTitle>
                    <CardDescription>Create, close, and resolve prediction markets</CardDescription>
                </div>
                <Skeleton className="h-10 w-32" />
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="flex items-center gap-4">
                            <Skeleton className="h-4 w-64" />
                            <Skeleton className="h-6 w-16" />
                            <Skeleton className="h-4 w-20" />
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-8 w-24" />
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
