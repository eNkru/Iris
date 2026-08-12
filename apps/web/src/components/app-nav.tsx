"use client";

import { authClient } from "@iris/auth/client";
import { Link, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "../hooks/use-session";
import { useI18n } from "../lib/i18n";
import { BrandMark } from "./brand-mark";
import { LanguageToggle } from "./language-toggle";
import { ThemeToggle } from "./theme-toggle";
import { ButtonSecondary } from "./ui";

/**
 * Sticky top navigation for authenticated pages: brand monogram + app links +
 * user email + sign out. Theme + language toggles live in the right cluster.
 * Project repo/issues links intentionally live only in the footer.
 *
 * Navigation swaps: `next/navigation` `usePathname`/`useRouter` and
 * `next/link` `<Link href>` → React Router `useLocation().pathname`/
 * `useNavigate` and `<Link to>`. `router.refresh()` (no SPA equivalent) is
 * replaced by `queryClient.clear()` (drops cached session/user data) then
 * `navigate("/login")`.
 */
export function AppNav() {
  const pathname = useLocation().pathname;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, loaded } = useSession();
  const { t } = useI18n();

  const handleSignOut = async () => {
    await authClient.signOut();
    queryClient.clear();
    navigate("/login", { replace: true });
  };

  const navLink = (href: string, label: string) => {
    // Home/products stays active on product detail routes; other links use
    // prefix match so nested settings paths still highlight.
    const active =
      href === "/"
        ? pathname === "/" || pathname.startsWith("/products")
        : pathname === href || pathname.startsWith(href);
    return (
      <Link
        to={href}
        className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950 ${
          active
            ? "bg-[var(--accent-muted)] text-[var(--accent)]"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/90 bg-white/90 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/90">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex min-w-0 items-center gap-1">
          <Link
            to="/"
            className="mr-2 inline-flex items-center gap-2 rounded-lg text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-1 dark:text-slate-100 dark:focus-visible:ring-offset-slate-950"
          >
            <BrandMark className="h-7 w-7" decorative />
            <span className="text-lg font-semibold tracking-tight">
              {t("brand.name")}
            </span>
          </Link>
          <nav className="ml-1 flex items-center gap-0.5" aria-label={t("nav.main")}>
            {navLink("/", t("nav.products"))}
            {navLink("/settings", t("nav.settings"))}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <LanguageToggle />
          <ThemeToggle />
          <span className="hidden max-w-[12rem] truncate text-sm text-slate-500 sm:inline dark:text-slate-400">
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
