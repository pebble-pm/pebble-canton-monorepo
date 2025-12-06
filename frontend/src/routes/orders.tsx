/**
 * Orders Page
 *
 * Displays user's order history
 */

import { createFileRoute, redirect } from "@tanstack/react-router";
import { OrdersTable } from "@/components/portfolio/orders-table";

export const Route = createFileRoute("/orders")({
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
    component: OrdersPage,
});

function OrdersPage() {
    return (
        <div className="container mx-auto p-6 space-y-6">
            <div className="mb-6">
                <h1 className="text-3xl font-bold">Orders</h1>
                <p className="text-muted-foreground">Your order history</p>
            </div>

            {/* Open Orders */}
            <OrdersTable />

            {/* Order History */}
            <OrdersTable showHistory />
        </div>
    );
}
