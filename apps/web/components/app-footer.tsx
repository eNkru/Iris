"use client";

import {
  PROJECT_ISSUES_URL,
  PROJECT_REPO_URL,
} from "../lib/project-links";
import { useI18n } from "../lib/i18n";

function GitHubIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function IssuesIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
      <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0z" />
    </svg>
  );
}

const externalLinkClass =
  "inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-slate-600 transition-colors hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-1 dark:text-slate-400 dark:hover:text-[var(--accent)] dark:focus-visible:ring-offset-slate-950";

/**
 * Shared project links (repo + issues). Used by the full app footer and the
 * compact login footer so URL/i18n stay in one place.
 */
export function ProjectLinks({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  return (
    <nav
      aria-label={t("footer.navLabel")}
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${className}`}
    >
      <a
        href={PROJECT_REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={externalLinkClass}
      >
        <GitHubIcon />
        {t("footer.repo")}
      </a>
      <a
        href={PROJECT_ISSUES_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={externalLinkClass}
      >
        <IssuesIcon />
        {t("footer.issues")}
      </a>
    </nav>
  );
}

/**
 * Authenticated-page footer: tagline + repo/issues entry points (footer-only
 * placement — no GitHub controls in the top nav).
 */
export function AppFooter() {
  const { t } = useI18n();
  return (
    <footer className="mt-auto border-t border-slate-200/90 bg-white/80 dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("footer.tagline")}
        </p>
        <ProjectLinks />
      </div>
    </footer>
  );
}
