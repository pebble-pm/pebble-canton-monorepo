/**
 * Admin Statistics Cards
 *
 * Displays platform statistics in a card grid
 */

import { BarChart3, Users, ShoppingCart, ArrowRightLeft, DollarSign, Wallet, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminStats } from "@/api/admin";
import { formatBalance, formatVolume } from "@/lib/formatters";

export function StatsCards() {
    const { data: stats, isLoading } = useAdminStats();

    if (isLoading) {
        return <StatsCardsSkeleton />;
    }

    if (!stats) {
        return null;
    }

    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Markets */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Markets</CardTitle>
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{stats.markets.total}</div>
                    <p className="text-xs text-muted-foreground">
                        {stats.markets.open} open, {stats.markets.closed} closed
                    </p>
                </CardContent>
            </Card>

            {/* Users */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Users</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{stats.users.total}</div>
                    <p className="text-xs text-muted-foreground">Total registered users</p>
                </CardContent>
            </Card>

            {/* Orders */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Orders</CardTitle>
                    <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{stats.orders.total}</div>
                    <p className="text-xs text-muted-foreground">{stats.orders.last24h} in last 24h</p>
                </CardContent>
            </Card>

            {/* Trades */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Trades</CardTitle>
                    <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{stats.trades.total}</div>
                    <p className="text-xs text-muted-foreground">
                        {stats.trades.pending} pending, {stats.trades.last24h} in 24h
                    </p>
                </CardContent>
            </Card>

            {/* Volume */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Volume</CardTitle>
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{formatVolume(stats.volume.total)}</div>
                    <p className="text-xs text-muted-foreground">Lifetime trading volume</p>
                </CardContent>
            </Card>

            {/* Total Balances */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Balances</CardTitle>
                    <Wallet className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{formatBalance(stats.balances.total)}</div>
                    <p className="text-xs text-muted-foreground">Across all accounts</p>
                </CardContent>
            </Card>

            {/* Canton Connection */}
            <Card className="md:col-span-2">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Canton Ledger</CardTitle>
                    {stats.cantonConnected ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                    )}
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{stats.cantonConnected ? "Connected" : "Disconnected"}</div>
                    <p className="text-xs text-muted-foreground">
                        {stats.cantonConnected ? "Ledger operations are active" : "Operating in offline mode"}
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}

function StatsCardsSkeleton() {
    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
                <Card key={i} className={i === 6 ? "md:col-span-2" : ""}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <Skeleton className="h-4 w-20" />
                        <Skeleton className="h-4 w-4" />
                    </CardHeader>
                    <CardContent>
                        <Skeleton className="h-8 w-16 mb-1" />
                        <Skeleton className="h-3 w-32" />
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
