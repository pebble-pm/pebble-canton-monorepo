/**
 * Login Page
 *
 * Party selection and authentication page
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PartySelector } from "@/components/auth/party-selector";
import { useAuthStore } from "@/stores/auth.store";
import { useEffect } from "react";

export const Route = createFileRoute("/login")({
    component: LoginPage,
});

function LoginPage() {
    const navigate = useNavigate();
    const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

    // Redirect if already authenticated
    useEffect(() => {
        if (isAuthenticated) {
            navigate({ to: "/" });
        }
    }, [isAuthenticated, navigate]);

    const handleSuccess = () => {
        navigate({ to: "/" });
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
            <PartySelector onSuccess={handleSuccess} />
        </div>
    );
}
