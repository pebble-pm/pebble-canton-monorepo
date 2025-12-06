/**
 * Portfolio Page
 *
 * Displays user positions, balances, and account summary
 */

import { createFileRoute, redirect } from "@tanstack/react-router";
import { BalanceCard } from "@/components/portfolio/balance-card";
import { PositionsTable } from "@/components/portfolio/positions-table";
import { OrdersTable } from "@/components/portfolio/orders-table";

export const Route = createFileRoute("/portfolio")({
    beforeLoad: () => {
        // Check auth from localStorage (Zustand persist)
        const stored = localStorage.getItem("pebble-auth");
        if (stored) {
            const parsed = JSON.parse(stored);
            if (!parsed.state?.isAuthenticated) {
                throw redirect({ to: "/login" });
            }
        } else {
            throw redirect({ to: "/login" });
        }
    },
    component: PortfolioPage,
});

function PortfolioPage() {
    return (
        <div className="container mx-auto p-6 space-y-6">
            <div className="mb-6">
                <h1 className="text-3xl font-bold">Portfolio</h1>
                <p className="text-muted-foreground">Your positions and account balance</p>
            </div>

            {/* Account Balance & Faucet */}
            <BalanceCard />

            {/* Open Orders */}
            <OrdersTable />

            {/* Positions */}
            <PositionsTable />
        </div>
    );
}
