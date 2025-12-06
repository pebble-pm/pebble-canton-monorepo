/**
 * Users Table
 *
 * Admin view of all users with their balances and activity
 */

import { Users as UsersIcon, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminUsers } from "@/api/admin";
import { formatBalance } from "@/lib/formatters";

export function UsersTable() {
    const { data: users, isLoading } = useAdminUsers();

    if (isLoading) {
        return <UsersTableSkeleton />;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <UsersIcon className="h-5 w-5" />
                    Users ({users?.length ?? 0})
                </CardTitle>
                <CardDescription>All registered users and their account details</CardDescription>
            </CardHeader>
            <CardContent>
                {!users || users.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">No users registered yet.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>User</TableHead>
                                    <TableHead>Canton</TableHead>
                                    <TableHead className="text-right">Available</TableHead>
                                    <TableHead className="text-right">Locked</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                    <TableHead className="text-right">Positions</TableHead>
                                    <TableHead className="text-right">Orders</TableHead>
                                    <TableHead className="text-right">Faucet</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {users.map((user) => (
                                    <TableRow key={user.userId}>
                                        <TableCell>
                                            <div>
                                                <div className="font-medium">{user.displayName}</div>
                                                <div className="text-xs text-muted-foreground truncate max-w-[200px]">{user.partyId}</div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {user.hasCantonAccount ? (
                                                <Badge variant="outline" className="text-green-500">
                                                    <CheckCircle className="mr-1 h-3 w-3" />
                                                    Yes
                                                </Badge>
                                            ) : (
                                                <Badge variant="outline" className="text-muted-foreground">
                                                    <XCircle className="mr-1 h-3 w-3" />
                                                    No
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">{formatBalance(user.availableBalance)}</TableCell>
                                        <TableCell className="text-right font-mono">{formatBalance(user.lockedBalance)}</TableCell>
                                        <TableCell className="text-right font-mono font-medium">
                                            {formatBalance(user.totalBalance)}
                                        </TableCell>
                                        <TableCell className="text-right">{user.positionCount}</TableCell>
                                        <TableCell className="text-right">{user.orderCount}</TableCell>
                                        <TableCell className="text-right">
                                            <div className="text-sm">
                                                <div>{user.faucetRequests} requests</div>
                                                <div className="text-xs text-muted-foreground">{formatBalance(user.faucetTotal)}</div>
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

function UsersTableSkeleton() {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <UsersIcon className="h-5 w-5" />
                    Users
                </CardTitle>
                <CardDescription>All registered users and their account details</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="flex items-center gap-4">
                            <Skeleton className="h-10 w-40" />
                            <Skeleton className="h-6 w-12" />
                            <Skeleton className="h-4 w-20" />
                            <Skeleton className="h-4 w-20" />
                            <Skeleton className="h-4 w-20" />
                            <Skeleton className="h-4 w-8" />
                            <Skeleton className="h-4 w-8" />
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
