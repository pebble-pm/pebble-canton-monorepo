/**
 * Faucet Page
 *
 * Request test tokens for trading
 */

import { createFileRoute, redirect } from "@tanstack/react-router";
import { FaucetCard } from "@/components/portfolio/faucet-card";
import { BalanceCard } from "@/components/portfolio/balance-card";

export const Route = createFileRoute("/faucet")({
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
    component: FaucetPage,
});

function FaucetPage() {
    return (
        <div className="container mx-auto p-6 space-y-6">
            <div className="mb-6">
                <h1 className="text-3xl font-bold">Faucet</h1>
                <p className="text-muted-foreground">Request test tokens for trading</p>
            </div>

            {/* Current Balance */}
            <BalanceCard />

            {/* Faucet Request */}
            <FaucetCard />
        </div>
    );
}
