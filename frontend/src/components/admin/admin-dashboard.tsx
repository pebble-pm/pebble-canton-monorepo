/**
 * Admin Dashboard
 *
 * Main container for admin features
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatsCards } from "./stats-cards";
import { MarketManagement } from "./market-management";
import { UsersTable } from "./users-table";

export function AdminDashboard() {
    return (
        <div className="space-y-6">
            {/* Statistics Overview */}
            <StatsCards />

            {/* Tabbed Content */}
            <Tabs defaultValue="markets" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="markets">Markets</TabsTrigger>
                    <TabsTrigger value="users">Users</TabsTrigger>
                </TabsList>

                <TabsContent value="markets">
                    <MarketManagement />
                </TabsContent>

                <TabsContent value="users">
                    <UsersTable />
                </TabsContent>
            </Tabs>
        </div>
    );
}
