import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

interface ThemeProviderProps {
    children: ReactNode;
}

/**
 * Theme provider using next-themes
 *
 * Supports light, dark, and system (default) themes.
 * Theme class is applied to the document root.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
    return (
        <NextThemesProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
            {children}
        </NextThemesProvider>
    );
}
