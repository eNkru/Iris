"use client";

import { authClient } from "@iris/auth/client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
    // Home/products stays active on product detail routes; other links use
    // prefix match so nested settings paths still highlight.
    const active =
      href === "/"
        ? pathname === "/" || pathname.startsWith("/products")
        : pathname === href || pathname.startsWith(href);
    return (
      <Link
        href={href}
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
            href="/"
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
