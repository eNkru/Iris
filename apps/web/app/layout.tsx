import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "../components/providers";
import { t } from "../lib/dictionary";
import { THEME_STORAGE_KEY } from "../lib/theme";
import { getLang } from "./lib/get-lang";

/**
 * Locale-aware document metadata: title/description follow the `iris.lang`
 * cookie resolved in `getLang()` so server-rendered head reflects the choice.
 */
export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  return {
    title: `Iris — ${t(lang, "home.title")}`,
    description: t(lang, "home.intro"),
  };
}

/**
 * Applies the stored theme class before hydration to prevent a light-mode
 * flash (FOUC) for dark-mode users.
 */
const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t? t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark");}catch(e){}})();`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased selection:bg-[var(--accent-muted)] selection:text-slate-900 dark:bg-slate-950 dark:text-slate-100 dark:selection:text-slate-50">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
