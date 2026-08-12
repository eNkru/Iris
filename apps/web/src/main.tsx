import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { SessionProvider } from "./components/session-provider";
import { LanguageProvider } from "./lib/i18n";
import { ThemeProvider } from "./lib/theme";
import { App } from "./app";
import "./index.css";

/**
 * Client entry (design.md §Architecture). Mounts the provider stack:
 *
 * QueryClientProvider (server state) → NuqsAdapter (URL state) →
 * SessionProvider (auth) → LanguageProvider (i18n) → ThemeProvider →
 * BrowserRouter (client routing) → App (routes + app shell).
 *
 * The NuqsAdapter swaps from `nuqs/adapters/next/app` to `nuqs/adapters/react`
 * (the generic adapter that uses the native History API — works alongside
 * React Router without needing a router-specific adapter).
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <NuqsAdapter>
        <SessionProvider>
          <LanguageProvider>
            <ThemeProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </ThemeProvider>
          </LanguageProvider>
        </SessionProvider>
      </NuqsAdapter>
    </QueryClientProvider>
  </StrictMode>,
);
