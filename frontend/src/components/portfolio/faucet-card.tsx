/**
 * Faucet Card Component
 *
 * Request test tokens from the faucet
 */

import { Droplets, Timer, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useFaucetStatus, useFaucetRequest } from "@/api/faucet";
import { formatBalance } from "@/lib/formatters";

export function FaucetCard() {
    const { data: status, isLoading } = useFaucetStatus();
    const faucetRequest = useFaucetRequest();

    const handleRequest = async () => {
        try {
            const result = await faucetRequest.mutateAsync(undefined);
            toast.success(`Received ${formatBalance(result.amount)}! New balance: ${formatBalance(result.newBalance)}`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to request tokens");
        }
    };

    if (isLoading) {
        return <FaucetCardSkeleton />;
    }

    // Calculate cooldown from nextAvailableAt
    const now = Date.now();
    const nextAvailable = status?.nextAvailableAt ? new Date(status.nextAvailableAt).getTime() : null;
    const cooldownMs = nextAvailable ? Math.max(0, nextAvailable - now) : 0;
    const cooldownSeconds = Math.ceil(cooldownMs / 1000);
    const cooldownMinutes = status?.config?.cooldownMinutes ?? 60;
    const cooldownPercent = cooldownMs > 0 ? Math.min(100, (cooldownMs / (cooldownMinutes * 60 * 1000)) * 100) : 0;

    // Determine the amount that will be given
    const requestAmount =
        status?.requestCount === 0
            ? (status?.config?.initialAmount ?? 1000)
            : (status?.config?.subsequentAmount ?? 100);

    return (
        <Card className="max-w-lg">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Droplets className="h-5 w-5 text-blue-500" />
                    Test Token Faucet
                </CardTitle>
                <CardDescription>Request free test tokens for trading on the sandbox</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Current Status */}
                <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total Received</span>
                        <span className="font-mono font-medium">{formatBalance(status?.totalReceived ?? "0")}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Request Count</span>
                        <span className="font-mono font-medium">{status?.requestCount ?? 0}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Next Request Amount</span>
                        <span className="font-mono font-medium">{formatBalance(requestAmount)}</span>
                    </div>
                </div>

                {/* Cooldown Progress */}
                {cooldownSeconds > 0 && (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Timer className="h-4 w-4" />
                            <span>
                                Cooldown:{" "}
                                {cooldownSeconds > 60 ? `${Math.ceil(cooldownSeconds / 60)}m` : `${cooldownSeconds}s`}{" "}
                                remaining
                            </span>
                        </div>
                        <Progress value={100 - cooldownPercent} className="h-2" />
                    </div>
                )}

                {/* Request Button */}
                {status?.canRequest ? (
                    <Button className="w-full" size="lg" onClick={handleRequest} disabled={faucetRequest.isPending}>
                        <Droplets className="mr-2 h-5 w-5" />
                        {faucetRequest.isPending ? "Requesting Tokens..." : `Request ${formatBalance(requestAmount)}`}
                    </Button>
                ) : (
                    <Button className="w-full" size="lg" disabled>
                        <Timer className="mr-2 h-5 w-5" />
                        {cooldownSeconds > 60 ? `Wait ${Math.ceil(cooldownSeconds / 60)}m` : `Wait ${cooldownSeconds}s`}
                    </Button>
                )}

                {/* Success message after request */}
                {faucetRequest.isSuccess && (
                    <div className="flex items-center gap-2 text-green-500 text-sm">
                        <CheckCircle className="h-4 w-4" />
                        <span>Tokens received! New balance: {formatBalance(faucetRequest.data.newBalance)}</span>
                    </div>
                )}

                {/* Help text */}
                <p className="text-xs text-muted-foreground text-center">
                    Faucet tokens are for testing only and have no real value. Cooldown: {cooldownMinutes} minutes
                    between requests.
                </p>
            </CardContent>
        </Card>
    );
}

function FaucetCardSkeleton() {
    return (
        <Card className="max-w-lg">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Droplets className="h-5 w-5 text-blue-500" />
                    Test Token Faucet
                </CardTitle>
                <CardDescription>Request free test tokens for trading on the sandbox</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                </div>
                <Skeleton className="h-12 w-full" />
            </CardContent>
        </Card>
    );
}
