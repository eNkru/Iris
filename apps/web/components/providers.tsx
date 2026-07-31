"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { useState, type ReactNode } from "react";
import { SessionProvider } from "./session-provider";

/**
 * Root client providers: React Query (server state) + session context
 * (frontend/authentication.md) + nuqs adapter (URL state via `useQueryState`,
 * frontend/state-management.md).
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <NuqsAdapter>{children}</NuqsAdapter>
      </SessionProvider>
    </QueryClientProvider>
  );
}
