"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { useSession } from "../hooks/use-session";
import { useI18n } from "../lib/i18n";
import { Spinner } from "./ui";

/**
 * Client-side route protection (frontend/authentication.md §4). Complements
 * `middleware.ts` (cookie-presence check) by handling the stale/expired
 * session case: once the session resolves and there is no user, redirect to
 * /login preserving the current path.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loaded } = useSession();
  const { t } = useI18n();

  useEffect(() => {
    if (loaded && !user) {
      const loginUrl = new URL("/login", window.location.origin);
      loginUrl.searchParams.set("redirectTo", pathname);
      router.replace(loginUrl.toString());
    }
  }, [loaded, user, pathname, router]);

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
