import pLimit from "p-limit";
import { logger } from "@iris/utils";

/**
 * Page fetching via a single real-browser transport (headless Chromium via
 * Playwright). Replaces the prior undici + wreq-js chain because some
 * retailers (e.g. thewarehouse.co.nz, pbtech.co.nz) sit behind Cloudflare's
 * Managed Security Challenge, which not only fingerprints HTTP/2 + TLS but
 * also serves a JavaScript challenge that requires execution to solve — a
 * real browser is the only universally-compatible transport.
 *
 * The browser is launched once per process and reused across all `fetchPage`
 * calls; each call creates a fresh `context` (so cookies and storage do not
 * leak between retailers) and disposes it in a `finally`. Concurrency is
 * still bounded by the shared `p-limit` (performance.md — Shared Limiter
 * Pattern), and the retry / exponential-backoff / structured-logging
 * envelope is preserved exactly as before so operational behaviour does not
 * change.
 */

const FETCH_CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;
const RETRY_JITTER_FACTOR = 0.5;

const BROWSER_LAUNCH_TIMEOUT_MS = 60_000;

export interface FetchPageResult {
  html: string;
  /** Final URL after redirects — useful context for the AI prompt. */
  url: string;
}

export interface FetchPageOptions {
  /** Optional caller context for structured logging. */
  productId?: string;
}

function calculateBackoffDelay(attempt: number): number {
  const exponential = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
  const capped = Math.min(exponential, RETRY_MAX_DELAY_MS);
  return capped + capped * RETRY_JITTER_FACTOR * Math.random();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Module-wide limiter: all page fetches share this concurrency budget. */
const pageFetchLimiter = pLimit(FETCH_CONCURRENCY);

/**
 * Lazily-launched shared Chromium browser. We deliberately import
 * `playwright` at the top of the file (not dynamically) because the package
 * is now a hard dependency: the prior wreq-js + undici chain is gone, so
 * every fetch path uses this.
 */
let browserPromise: Promise<import("playwright").Browser> | null = null;

async function getBrowser(): Promise<import("playwright").Browser> {
  if (browserPromise === null) {
    browserPromise = (async () => {
      const { chromium } = await import("playwright");
      logger.info("Launching shared Playwright Chromium browser");
      const browser = await chromium.launch({
        headless: true,
        timeout: BROWSER_LAUNCH_TIMEOUT_MS,
      });
      // Close on process exit so a dev / test process never leaves a zombie
      // Chromium running. `beforeExit` only fires on graceful exit; the OS
      // still reaps the process on signal.
      const shutdown = () => {
        void browser.close().catch(() => {
          // Ignore — process is exiting.
        });
      };
      process.once("beforeExit", shutdown);
      return browser;
    })();
  }
  return browserPromise;
}

/**
 * Perform a single Playwright fetch. Returns a discriminated result the retry
 * loop can branch on: a successful page, a non-2xx HTTP status, or an
 * out-of-band transport error (timeout, navigation failure, browser crash).
 */
type FetchAttempt =
  | { kind: "ok"; status: number; url: string; html: string }
  | { kind: "status"; status: number; url: string }
  | { kind: "error"; message: string };

async function attemptPlaywrightFetch(
  url: string,
  options: FetchPageOptions,
): Promise<FetchAttempt> {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: FETCH_TIMEOUT_MS,
    });

    if (!response) {
      return { kind: "error", message: "navigation produced no response" };
    }

    if (!response.ok()) {
      return { kind: "status", status: response.status(), url: page.url() };
    }

    const html = await page.content();
    return { kind: "ok", status: response.status(), url: page.url(), html };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("Page fetch transport error", {
      url,
      error: message,
      productId: options.productId,
    });
    return { kind: "error", message };
  } finally {
    await page.close().catch(() => {
      // Already closed or being torn down — ignore.
    });
    await context.close().catch(() => {
      // Ignore.
    });
  }
}

/**
 * Fetch a product page. Returns `null` when the fetch ultimately fails (status
 * or transport error after retries) so callers can treat it as a failed check.
 */
export async function fetchPage(
  url: string,
  options: FetchPageOptions = {},
): Promise<FetchPageResult | null> {
  return pageFetchLimiter(async () => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const result = await attemptPlaywrightFetch(url, options);

      if (result.kind === "ok") {
        return { html: result.html, url: result.url };
      }

      if (result.kind === "status") {
        logger.warn("Page fetch returned non-2xx status", {
          url,
          status: result.status,
          attempt,
          productId: options.productId,
        });
      } else {
        // Already logged inside attemptPlaywrightFetch.
      }

      if (attempt < MAX_RETRIES) {
        const delay = calculateBackoffDelay(attempt);
        await sleep(delay);
        continue;
      }

      logger.error("Page fetch failed after retries", {
        url,
        status: result.kind === "status" ? result.status : undefined,
        error: result.kind === "error" ? result.message : undefined,
        productId: options.productId,
      });
      return null;
    }

    return null;
  });
}
