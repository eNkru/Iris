"use client";

import { authClient } from "@iris/auth/client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "../hooks/use-session";
import { ButtonSecondary } from "./ui";

/**
 * Top navigation for authenticated pages: app links + user email + sign out
 * (frontend/authentication.md §5 sign out flow).
 */
export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loaded } = useSession();

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
        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-1 ${
          active ? "bg-slate-200 text-slate-900" : "text-slate-600 hover:text-slate-900"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-1">
          <Link href="/" className="mr-2 text-lg font-semibold text-slate-900">
            Iris
          </Link>
          {navLink("/", "Products")}
          {navLink("/settings", "Settings")}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">
            {loaded ? user?.email ?? "" : "…"}
          </span>
          <ButtonSecondary onClick={handleSignOut}>Sign out</ButtonSecondary>
        </div>
      </div>
    </header>
  );
}
