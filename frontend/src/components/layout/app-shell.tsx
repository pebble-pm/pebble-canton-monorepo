/**
 * App Shell Layout
 *
 * Main layout with sidebar navigation using shadcn sidebar components
 */

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { SidebarNav } from "./sidebar-nav";

interface AppShellProps {
    children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
    return (
        <SidebarProvider defaultOpen={true}>
            <SidebarNav />
            <SidebarInset>
                <main className="flex-1 overflow-auto">{children}</main>
            </SidebarInset>
        </SidebarProvider>
    );
}
