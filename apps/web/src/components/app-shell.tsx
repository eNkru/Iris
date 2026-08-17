import type { ReactNode } from "react";
import { AppFooter } from "./app-footer";
import { AppNav } from "./app-nav";

/**
 * Authenticated app chrome: sticky nav, flex-growing main (max-w-5xl), footer
 * pinned to the bottom of the viewport when content is short.
 */
export function AppShell({
  children,
  mainClassName = "",
}: {
  children: ReactNode;
  /** Extra classes on the centered main element (spacing variants per page). */
  mainClassName?: string;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-stone-50 dark:bg-stone-950">
      <AppNav />
      <main
        className={`mx-auto w-full max-w-5xl flex-1 px-6 py-8 ${mainClassName}`}
      >
        {children}
      </main>
      <AppFooter />
    </div>
  );
}
