"use client";

import { authClient } from "@iris/auth/client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "../hooks/use-session";
import { useI18n } from "../lib/i18n";
import { LanguageToggle } from "./language-toggle";
import { ThemeToggle } from "./theme-toggle";
import { ButtonSecondary } from "./ui";

/**
 * Top navigation for authenticated pages: app links + user email + sign out
 * (frontend/authentication.md §5 sign out flow). The theme + language toggles
 * live in the right-side cluster next to the email / sign out.
 */
export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loaded } = useSession();
  const { t } = useI18n();

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  };

  const navLink = (href: string, label: string) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-1 dark:focus-visible:ring-slate-400 dark:focus-visible:ring-offset-slate-950 ${
          active
            ? "bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
            : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-1">
          <Link
            href="/"
            className="mr-2 text-lg font-semibold text-slate-900 dark:text-slate-100"
          >
            Iris
          </Link>
          {navLink("/", t("nav.products"))}
          {navLink("/settings", t("nav.settings"))}
        </div>
        <div className="flex items-center gap-3">
          <LanguageToggle />
          <ThemeToggle />
          <span className="hidden text-sm text-slate-500 sm:inline dark:text-slate-400">
            {loaded ? user?.email ?? "" : "…"}
          </span>
          <ButtonSecondary onClick={handleSignOut}>
            {t("nav.signOut")}
          </ButtonSecondary>
        </div>
      </div>
    </header>
  );
}
