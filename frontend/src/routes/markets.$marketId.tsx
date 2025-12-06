/**
 * Market Detail Page
 *
 * Displays single market with orderbook and trading interface
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMarket } from "@/api/markets";
import { MarketHeader } from "@/components/market/market-header";
import { DualOrderbook } from "@/components/market/orderbook";
import { TradeFeed } from "@/components/market/trade-feed";
import { OrderForm } from "@/components/trading/order-form";
import { useMarketSubscription } from "@/hooks/use-websocket";

export const Route = createFileRoute("/markets/$marketId")({
    component: MarketDetailPage,
});

function MarketDetailPage() {
    const { marketId } = Route.useParams();
    const { data: market, isLoading, error } = useMarket(marketId);

    // Subscribe to real-time updates for this market
    useMarketSubscription(marketId);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error || !market) {
        return (
            <div className="container mx-auto p-6">
                <div className="text-center py-12">
                    <p className="text-destructive mb-4">{error?.message || "Market not found"}</p>
                    <Button asChild variant="outline">
                        <Link to="/">
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Back to Markets
                        </Link>
                    </Button>
                </div>
            </div>
        );
    }

    const isOpen = market.status === "open";

    return (
        <div className="container mx-auto p-6 space-y-6">
            {/* Back button */}
            <div>
                <Button asChild variant="ghost" size="sm">
                    <Link to="/">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Markets
                    </Link>
                </Button>
            </div>

            {/* Market header */}
            <MarketHeader market={market} />

            {/* Main content grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left column - Orderbook and Trades */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Orderbook */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Order Book</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {isOpen ? (
                                <DualOrderbook orderbook={market.orderbook} />
                            ) : (
                                <div className="text-center py-8 text-muted-foreground">
                                    Market is {market.status}. Order book is not available.
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Recent Trades */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Recent Trades</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <TradeFeed trades={market.recentTrades} />
                        </CardContent>
                    </Card>
                </div>

                {/* Right column - Trading Panel */}
                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Trade</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {isOpen ? (
                                <OrderForm
                                    marketId={marketId}
                                    yesPrice={parseFloat(market.yesPrice)}
                                    noPrice={parseFloat(market.noPrice)}
                                />
                            ) : (
                                <div className="text-center py-8 text-muted-foreground">
                                    <p>Market is {market.status}</p>
                                    <p className="text-sm mt-2">Trading is not available</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
