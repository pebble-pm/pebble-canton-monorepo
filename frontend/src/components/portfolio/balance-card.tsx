/**
 * Balance Card Component
 *
 * Displays account balance and faucet button
 */

import { Wallet, RefreshCw, Droplets } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccount } from "@/api/account";
import { useFaucetStatus, useFaucetRequest } from "@/api/faucet";
import { formatBalance } from "@/lib/formatters";

export function BalanceCard() {
    const { data: account, isLoading: accountLoading, refetch } = useAccount();
    const { data: faucetStatus, isLoading: faucetLoading } = useFaucetStatus();
    const faucetRequest = useFaucetRequest();

    const handleFaucetRequest = async () => {
        try {
            const result = await faucetRequest.mutateAsync(undefined);
            toast.success(`Received ${formatBalance(result.amount)} from faucet`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to request tokens");
        }
    };

    if (accountLoading) {
        return <BalanceCardSkeleton />;
    }

    if (!account) {
        return null;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Wallet className="h-5 w-5" />
                    Account Balance
                </CardTitle>
                <CardDescription>Your trading account summary</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {/* Available Balance */}
                    <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Available</p>
                        <p className="text-2xl font-bold tabular-nums">{formatBalance(account.availableBalance)}</p>
                    </div>

                    {/* Locked Balance */}
                    <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Locked in Orders</p>
                        <p className="text-2xl font-bold tabular-nums">{formatBalance(account.lockedBalance)}</p>
                    </div>

                    {/* Positions Value */}
                    <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Positions Value</p>
                        <p className="text-2xl font-bold tabular-nums">{formatBalance(account.positionsValue)}</p>
                    </div>

                    {/* Total Equity */}
                    <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Total Equity</p>
                        <p className="text-2xl font-bold tabular-nums">{formatBalance(account.totalEquity)}</p>
                    </div>
                </div>

                {/* Actions */}
                <div className="mt-6 flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => refetch()} disabled={accountLoading}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Refresh
                    </Button>

                    <Button
                        variant="default"
                        size="sm"
                        onClick={handleFaucetRequest}
                        disabled={faucetLoading || faucetRequest.isPending || !faucetStatus?.canRequest}
                    >
                        <Droplets className="mr-2 h-4 w-4" />
                        {faucetRequest.isPending ? "Requesting..." : !faucetStatus?.canRequest ? "Cooldown..." : "Get Test Tokens"}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

function BalanceCardSkeleton() {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Wallet className="h-5 w-5" />
                    Account Balance
                </CardTitle>
                <CardDescription>Your trading account summary</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="space-y-2">
                            <Skeleton className="h-4 w-20" />
                            <Skeleton className="h-8 w-28" />
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
