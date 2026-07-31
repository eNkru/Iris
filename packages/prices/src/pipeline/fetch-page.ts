import pLimit from "p-limit";
import { logger } from "@iris/utils";

/**
 * Page fetching with a realistic browser User-Agent, timeout, shared concurrency
 * limiter, and exponential backoff with jitter for retryable responses
 * (performance.md — Shared Limiter Pattern + Rate Limit Retry).
 */

const FETCH_CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;
const RETRY_JITTER_FACTOR = 0.5;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

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
 * Fetch a product page. Returns `null` when the fetch ultimately fails (status
 * or network error after retries) so callers can treat it as a failed check.
 */
export async function fetchPage(
  url: string,
  options: FetchPageOptions = {},
): Promise<FetchPageResult | null> {
  return pageFetchLimiter(async () => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en,zh;q=0.9",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!response.ok) {
          if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_RETRIES) {
            const delay = calculateBackoffDelay(attempt);
            logger.warn("Page fetch returned retryable status; backing off", {
              url,
              status: response.status,
              attempt,
              delayMs: Math.round(delay),
              productId: options.productId,
            });
            await sleep(delay);
            continue;
          }

          logger.warn("Page fetch failed", {
            url,
            status: response.status,
            attempt,
            productId: options.productId,
          });
          return null;
        }

        const html = await response.text();
        return { html, url: response.url };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (attempt < MAX_RETRIES) {
          const delay = calculateBackoffDelay(attempt);
          logger.warn("Page fetch network error; retrying", {
            url,
            attempt,
            delayMs: Math.round(delay),
            error: message,
            productId: options.productId,
          });
          await sleep(delay);
          continue;
        }

        logger.error("Page fetch failed after retries", {
          url,
          error: message,
          productId: options.productId,
        });
        return null;
      }
    }

    return null;
  });
}
