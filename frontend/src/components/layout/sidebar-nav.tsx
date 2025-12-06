/**
 * Sidebar Navigation
 *
 * Main navigation sidebar with markets, portfolio, and user sections
 */

import { Link, useRouterState } from "@tanstack/react-router";
import { BarChart3, Briefcase, ClipboardList, Droplets, Home, Shield } from "lucide-react";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarSeparator,
} from "@/components/ui/sidebar";
import { UserMenu } from "@/components/auth/user-menu";
import { useAuthStore, useIsAdmin } from "@/stores/auth.store";

const mainNavItems = [
    {
        title: "Markets",
        url: "/",
        icon: BarChart3,
    },
];

const portfolioNavItems = [
    {
        title: "Portfolio",
        url: "/portfolio",
        icon: Briefcase,
    },
    {
        title: "Orders",
        url: "/orders",
        icon: ClipboardList,
    },
];

export function SidebarNav() {
    const routerState = useRouterState();
    const currentPath = routerState.location.pathname;
    const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
    const isAdmin = useIsAdmin();

    return (
        <Sidebar variant="sidebar" collapsible="icon">
            <SidebarHeader className="border-b border-sidebar-border">
                <div className="flex items-center gap-2 px-2 py-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                        <Home className="h-4 w-4" />
                    </div>
                    <div className="flex flex-col group-data-[collapsible=icon]:hidden">
                        <span className="text-sm font-semibold">Pebble</span>
                        <span className="text-xs text-muted-foreground">Prediction Markets</span>
                    </div>
                </div>
            </SidebarHeader>

            <SidebarContent>
                {/* Main Navigation */}
                <SidebarGroup>
                    <SidebarGroupLabel>Navigation</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {mainNavItems.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton asChild isActive={currentPath === item.url} tooltip={item.title}>
                                        <Link to={item.url}>
                                            <item.icon className="h-4 w-4" />
                                            <span>{item.title}</span>
                                        </Link>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>

                {/* Portfolio Section - Only show when authenticated */}
                {isAuthenticated && (
                    <>
                        <SidebarSeparator />
                        <SidebarGroup>
                            <SidebarGroupLabel>Your Account</SidebarGroupLabel>
                            <SidebarGroupContent>
                                <SidebarMenu>
                                    {portfolioNavItems.map((item) => (
                                        <SidebarMenuItem key={item.title}>
                                            <SidebarMenuButton asChild isActive={currentPath === item.url} tooltip={item.title}>
                                                <Link to={item.url}>
                                                    <item.icon className="h-4 w-4" />
                                                    <span>{item.title}</span>
                                                </Link>
                                            </SidebarMenuButton>
                                        </SidebarMenuItem>
                                    ))}
                                </SidebarMenu>
                            </SidebarGroupContent>
                        </SidebarGroup>
                    </>
                )}

                {/* Faucet - Only show when authenticated */}
                {isAuthenticated && (
                    <>
                        <SidebarSeparator />
                        <SidebarGroup>
                            <SidebarGroupLabel>Testnet</SidebarGroupLabel>
                            <SidebarGroupContent>
                                <SidebarMenu>
                                    <SidebarMenuItem>
                                        <SidebarMenuButton asChild isActive={currentPath === "/faucet"} tooltip="Faucet">
                                            <Link to="/faucet">
                                                <Droplets className="h-4 w-4" />
                                                <span>Faucet</span>
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                </SidebarMenu>
                            </SidebarGroupContent>
                        </SidebarGroup>
                    </>
                )}

                {/* Admin - Only show for PebbleAdmin users */}
                {isAdmin && (
                    <>
                        <SidebarSeparator />
                        <SidebarGroup>
                            <SidebarGroupLabel>Administration</SidebarGroupLabel>
                            <SidebarGroupContent>
                                <SidebarMenu>
                                    <SidebarMenuItem>
                                        <SidebarMenuButton asChild isActive={currentPath === "/admin"} tooltip="Admin Panel">
                                            <Link to="/admin">
                                                <Shield className="h-4 w-4" />
                                                <span>Admin Panel</span>
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                </SidebarMenu>
                            </SidebarGroupContent>
                        </SidebarGroup>
                    </>
                )}
            </SidebarContent>

            <SidebarFooter className="border-t border-sidebar-border">
                <UserMenu />
            </SidebarFooter>
        </Sidebar>
    );
}
