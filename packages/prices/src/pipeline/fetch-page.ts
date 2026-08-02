import pLimit from "p-limit";
import { logger } from "@iris/utils";

/**
 * Page fetching with a realistic browser User-Agent, timeout, shared concurrency
 * limiter, and exponential backoff with jitter for retryable responses
 * (performance.md — Shared Limiter Pattern + Rate Limit Retry).
 *
 * Transport fallback (design: 08-02-pbtech-url-parsing): some retailers sit behind
 * Cloudflare's Managed Security Challenge, which fingerprints the HTTP/2 + TLS
 * client and returns `403`/`503` to Node's native fetch (undici). To deliver the
 * page anyway, a challenge response is retried with a browser-TLS fingerprint
 * impersonator (`wreq-js`, a Rust/NAPI client) under the same shared limiter.
 * The undici path is untouched for retailers that already work.
 */

const FETCH_CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;
const RETRY_JITTER_FACTOR = 0.5;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/** Cloudflare challenge responses that undici is routinely flagged for. */
const CHALLENGE_STATUS_CODES = new Set([403, 503, 529]);

/** Browser profile used by the TLS fallback (matches the User-Agent below). */
const BROWSER_TLS_PROFILE = "chrome_130" as const;

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en,zh;q=0.9",
} as const;

/** Module-wide limiter: all page fetches share this concurrency budget. */
const pageFetchLimiter = pLimit(FETCH_CONCURRENCY);

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

/**
 * Retry a request using a browser TLS fingerprint impersonator. Loaded lazily
 * (dynamic import) so the native binding is only resolved on a challenge path
 * and never interferes with the undici path of existing retailers.
 *
 * Returns `null` on any failure (non-2xx status or transport error) so the
 * caller can keep its normal retry/backoff/`null` semantics.
 */
async function fetchWithBrowserTls(
  url: string,
  options: FetchPageOptions,
): Promise<FetchPageResult | null> {
  try {
    const wreq = await import("wreq-js");

    const response = await wreq.fetch(url, {
      browser: BROWSER_TLS_PROFILE,
      os: "linux",
      headers: DEFAULT_HEADERS,
      redirect: "follow",
      timeout: FETCH_TIMEOUT_MS,
    });

    if (!response.ok) {
      logger.warn("Browser-TLS fallback did not produce a 2xx", {
        url,
        status: response.status,
        productId: options.productId,
      });
      return null;
    }

    const html = await response.text();
    logger.info("Page fetched via browser-TLS transport", {
      url,
      status: response.status,
      productId: options.productId,
    });
    return { html, url: response.url };
  } catch (error) {
    logger.error("Browser-TLS fetch failed", {
      url,
      error: error instanceof Error ? error.message : String(error),
      productId: options.productId,
    });
    return null;
  }
}

/**
 * Perform the undici fetch without throwing. Returns a discriminated result the
 * retry loop can branch on: a successful page, a non-2xx HTTP status, or an
 * out-of-band transport error (timeout, DNS, etc.).
 */
type FetchAttempt =
  | { kind: "ok"; status: number; url: string; html: string }
  | { kind: "status"; status: number; url: string }
  | { kind: "error"; message: string };

async function attemptUndiciFetch(url: string): Promise<FetchAttempt> {
  try {
    const response = await fetch(url, {
      headers: DEFAULT_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { kind: "status", status: response.status, url: response.url };
    }

    const html = await response.text();
    return { kind: "ok", status: response.status, url: response.url, html };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "error", message };
  }
}

/**
 * Fetch a product page. Returns `null` when the fetch ultimately fails (status
 * or network error after retries) so callers can treat it as a failed check.
 */
export async function fetchPage(
  url: string,
  options: FetchPageOptions = {},
): Promise<FetchPageResult | null> {
  return pageFetchLimiter(async () => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const result = await attemptUndiciFetch(url);

      if (result.kind === "ok") {
        return { html: result.html, url: result.url };
      }

      // Cloudflare Managed Challenge: undici's TLS fingerprint is flagged, but a
      // browser-TLS aware transport usually passes. Try it before backoff/null.
      if (result.kind === "status" && CHALLENGE_STATUS_CODES.has(result.status)) {
        logger.warn("Page fetch hit a Cloudflare challenge; trying browser-TLS transport", {
          url,
          status: result.status,
          attempt,
          productId: options.productId,
        });

        const tlsResult = await fetchWithBrowserTls(url, options);
        if (tlsResult) {
          return tlsResult;
        }

        logger.warn("Browser-TLS fallback failed; backing off", {
          url,
          status: result.status,
          attempt,
          productId: options.productId,
        });
      } else if (result.kind === "status" && RETRYABLE_STATUS_CODES.has(result.status)) {
        logger.warn("Page fetch returned retryable status; backing off", {
          url,
          status: result.status,
          attempt,
          productId: options.productId,
        });
      } else if (result.kind === "error") {
        logger.warn("Page fetch network error; retrying", {
          url,
          attempt,
          error: result.message,
          productId: options.productId,
        });
      } else {
        // Non-retryable, non-challenge HTTP status → hard failure.
        logger.warn("Page fetch failed", {
          url,
          status: result.kind === "status" ? result.status : undefined,
          attempt,
          productId: options.productId,
        });
        return null;
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