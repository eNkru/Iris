"use client";

import { authClient } from "@iris/auth/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { SessionContext, type SessionContextValue } from "../lib/session-context";

/**
 * Session query key shared by the provider, hooks, and auth flows
 * (frontend/authentication.md §3 — cache invalidation after auth changes).
 */
export const sessionQueryKey = ["user", "session"] as const;

export function useSessionQuery() {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: async () => {
      const { data, error } = await authClient.getSession({
        query: { disableCookieCache: true },
      });
      if (error) {
        throw new Error(error.message || "Failed to fetch session");
      }
      return data;
    },
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/**
 * Session provider (frontend/authentication.md §3). Wraps better-auth's session
 * in React Query so pages can render a `loaded` gate without flashing
 * unauthenticated content during static prerendering.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: sessionData } = useSessionQuery();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (sessionData) {
      setLoaded(true);
    }
  }, [sessionData]);

  const value: SessionContextValue = {
    loaded,
    session: sessionData?.session ?? null,
    user: sessionData?.user ?? null,
    reloadSession: async () => {
      const { data, error } = await authClient.getSession({
        query: { disableCookieCache: true },
      });
      if (error) {
        throw new Error(error.message || "Failed to fetch session");
      }
      queryClient.setQueryData(sessionQueryKey, () => data);
      setLoaded(true);
    },
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
