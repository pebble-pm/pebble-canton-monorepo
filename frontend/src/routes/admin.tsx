/**
 * Admin Page
 *
 * Platform administration - stats, market management, user overview
 * Requires PebbleAdmin authentication
 */

import { createFileRoute, redirect } from "@tanstack/react-router";
import { AdminDashboard } from "@/components/admin/admin-dashboard";

export const Route = createFileRoute("/admin")({
    beforeLoad: () => {
        // Check auth from localStorage (Zustand persist)
        const stored = localStorage.getItem("pebble-auth");
        if (!stored) {
            throw redirect({ to: "/login" });
        }

        const parsed = JSON.parse(stored);
        if (!parsed.state?.isAuthenticated) {
            throw redirect({ to: "/login" });
        }

        // Check if user is admin (partyId starts with "PebbleAdmin")
        const partyId = parsed.state?.partyId;
        if (!partyId || !partyId.startsWith("PebbleAdmin")) {
            // Non-admin users get redirected to home
            throw redirect({ to: "/" });
        }
    },
    component: AdminPage,
});

function AdminPage() {
    return (
        <div className="container mx-auto p-6 space-y-6">
            <div className="mb-6">
                <h1 className="text-3xl font-bold">Admin Dashboard</h1>
                <p className="text-muted-foreground">Platform administration and market management</p>
            </div>

            <AdminDashboard />
        </div>
    );
}
