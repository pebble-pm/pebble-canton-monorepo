/**
 * Orders Table Component
 *
 * Displays user's open orders with cancel action
 */

import { Link } from "@tanstack/react-router";
import { ClipboardList, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrders, useCancelOrder } from "@/api/orders";
import { useMarkets } from "@/api/markets";
import { formatQuantity, formatRelativeTime } from "@/lib/formatters";
import type { OrderResponse } from "@/types/api";

interface OrdersTableProps {
    /** Filter to show only specific status orders */
    status?: "open" | "filled" | "partial" | "cancelled";
    /** Show cancelled/filled orders (history mode) */
    showHistory?: boolean;
}

export function OrdersTable({ status, showHistory = false }: OrdersTableProps) {
    const { data: orders, isLoading } = useOrders(status ? { status } : undefined);
    const { data: markets } = useMarkets();

    // Filter orders based on mode
    const filteredOrders = orders?.filter((order) => {
        if (showHistory) {
            return order.status === "filled" || order.status === "cancelled";
        }
        return order.status === "open" || order.status === "partial";
    });

    if (isLoading) {
        return <OrdersTableSkeleton showHistory={showHistory} />;
    }

    const title = showHistory ? "Order History" : "Open Orders";
    const description = showHistory ? "Your completed and cancelled orders" : "Your pending orders";

    if (!filteredOrders || filteredOrders.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <ClipboardList className="h-5 w-5" />
                        {title}
                    </CardTitle>
                    <CardDescription>{description}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                        <ClipboardList className="mb-4 h-12 w-12 opacity-50" />
                        <p className="text-lg font-medium">{showHistory ? "No order history" : "No open orders"}</p>
                        <p className="text-sm">
                            {showHistory ? "Your completed orders will appear here" : "Place orders on markets to see them here"}
                        </p>
                        {!showHistory && (
                            <Button asChild className="mt-4">
                                <Link to="/">Browse Markets</Link>
                            </Button>
                        )}
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
                    <ClipboardList className="h-5 w-5" />
                    {title} ({filteredOrders.length})
                </CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Market</TableHead>
                            <TableHead>Side</TableHead>
                            <TableHead>Action</TableHead>
                            <TableHead className="text-right">Price</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Filled</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Time</TableHead>
                            {!showHistory && <TableHead className="text-right">Actions</TableHead>}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredOrders.map((order) => (
                            <OrderRow
                                key={order.orderId}
                                order={order}
                                marketQuestion={marketMap.get(order.marketId)?.question ?? order.marketId}
                                showHistory={showHistory}
                            />
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}

interface OrderRowProps {
    order: OrderResponse;
    marketQuestion: string;
    showHistory: boolean;
}

function OrderRow({ order, marketQuestion, showHistory }: OrderRowProps) {
    const cancelOrder = useCancelOrder();

    const handleCancel = async () => {
        try {
            await cancelOrder.mutateAsync(order.orderId);
            toast.success("Order cancelled");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to cancel order");
        }
    };

    const statusColors: Record<string, string> = {
        open: "bg-blue-500/10 text-blue-500 border-blue-500/50",
        partial: "bg-yellow-500/10 text-yellow-500 border-yellow-500/50",
        filled: "bg-green-500/10 text-green-500 border-green-500/50",
        cancelled: "bg-muted text-muted-foreground",
    };

    const filledPercent = ((parseFloat(order.filledQuantity) / parseFloat(order.quantity)) * 100).toFixed(0);

    return (
        <TableRow>
            <TableCell>
                <Link to="/markets/$marketId" params={{ marketId: order.marketId }} className="flex items-center gap-1 hover:underline">
                    <span className="max-w-[180px] truncate">{marketQuestion}</span>
                    <ExternalLink className="h-3 w-3 opacity-50" />
                </Link>
            </TableCell>
            <TableCell>
                <Badge
                    variant="outline"
                    className={order.side === "yes" ? "border-green-500/50 text-green-500" : "border-red-500/50 text-red-500"}
                >
                    {order.side.toUpperCase()}
                </Badge>
            </TableCell>
            <TableCell>
                <Badge variant="secondary">{order.action.toUpperCase()}</Badge>
            </TableCell>
            <TableCell className="text-right font-mono">{Math.round(parseFloat(order.price) * 100)}¢</TableCell>
            <TableCell className="text-right font-mono">{formatQuantity(order.quantity)}</TableCell>
            <TableCell className="text-right font-mono">
                {formatQuantity(order.filledQuantity)}
                <span className="ml-1 text-xs text-muted-foreground">({filledPercent}%)</span>
            </TableCell>
            <TableCell>
                <Badge variant="outline" className={statusColors[order.status]}>
                    {order.status}
                </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">{formatRelativeTime(order.createdAt)}</TableCell>
            {!showHistory && (
                <TableCell className="text-right">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCancel}
                        disabled={cancelOrder.isPending}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    >
                        <X className="h-4 w-4" />
                        <span className="sr-only">Cancel order</span>
                    </Button>
                </TableCell>
            )}
        </TableRow>
    );
}

function OrdersTableSkeleton({ showHistory }: { showHistory?: boolean }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ClipboardList className="h-5 w-5" />
                    {showHistory ? "Order History" : "Open Orders"}
                </CardTitle>
                <CardDescription>{showHistory ? "Your completed orders" : "Your pending orders"}</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="flex items-center gap-4">
                            <Skeleton className="h-4 w-40" />
                            <Skeleton className="h-4 w-12" />
                            <Skeleton className="h-4 w-12" />
                            <Skeleton className="h-4 w-16" />
                            <Skeleton className="h-4 w-16" />
                            <Skeleton className="h-4 w-20" />
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
