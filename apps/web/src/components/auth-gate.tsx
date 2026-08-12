"use client";

import { useLocation, useNavigate } from "react-router";
import { type ReactNode, useEffect } from "react";
import { useSession } from "../hooks/use-session";
import { useI18n } from "../lib/i18n";
import { Spinner } from "./ui";

/**
 * Client-side route protection (frontend/authentication.md §4). Complements
 * the server-side auth gate in `server.ts` (cookie-presence check) by handling
 * the stale/expired session case: once the session resolves and there is no
 * user, redirect to /login preserving the current path.
 *
 * Navigation swaps: `next/navigation` `usePathname`/`useRouter` → React Router
 * `useLocation().pathname`/`useNavigate`.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useLocation().pathname;
  const { user, loaded } = useSession();
  const { t } = useI18n();

  useEffect(() => {
    if (loaded && !user) {
      const loginUrl = new URL("/login", window.location.origin);
      loginUrl.searchParams.set("redirectTo", pathname);
      navigate(loginUrl.pathname + loginUrl.search, { replace: true });
    }
  }, [loaded, user, pathname, navigate]);

  if (!loaded) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Spinner label={t("authGate.loading")} />
      </main>
    );
  }

  if (!user) {
    return null; // redirecting
  }

  return <>{children}</>;
}
