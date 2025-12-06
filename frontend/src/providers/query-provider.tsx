import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { STALE_TIMES } from "@/lib/constants";

interface QueryProviderProps {
    children: ReactNode;
}

/**
 * TanStack Query provider with default configuration
 */
export function QueryProvider({ children }: QueryProviderProps) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: STALE_TIMES.MARKETS,
                        gcTime: 1000 * 60 * 5, // 5 minutes garbage collection
                        retry: 1,
                        refetchOnWindowFocus: false,
                    },
                    mutations: {
                        retry: 0,
                    },
                },
            }),
    );

    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
