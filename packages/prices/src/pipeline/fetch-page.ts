import pLimit from "p-limit";
import { getEnv, logger } from "@iris/utils";
import { detectBlockedPage, isBlockedSignatureRetryable } from "./blocked-signatures";

/**
 * Page fetching via a single anti-detect-browser transport (Camoufox) hosted
 * in a sidecar HTTP service. Replaces the prior in-process Playwright Chromium
 * transport: several major NZ retailers sit behind hard anti-bot challenges
 * (DataDome / Cloudflare managed / Akamai Bot Manager) that plain Chromium
 * cannot pass, so `create` failed with the generic "Page fetch failed".
 *
 * Camoufox is an engine-level anti-detect Firefox fork; the 2026-08-04 spike
 * proved it passes all three challenge classes for free. It is now the SINGLE
 * fetch transport — there is no Playwright/Chromium in the app anymore, and no
 * dual-path orchestration. The sidecar is a required dependency in every
 * environment (design.md §Config, AC5).
 *
 * This module is a thin HTTP client for the sidecar. It preserves the
 * operational envelope of the prior transport: the shared `pLimit`
 * (performance.md — Shared Limiter Pattern), the retry / exponential-backoff /
 * jitter loop, and the structured logging. The sidecar holds ONE shared
 * `AsyncCamoufox` browser and bounds concurrency with its own asyncio
 * semaphore matching `FETCH_CONCURRENCY`.
 *
 * `fetchPage` returns a discriminated union so callers can distinguish a real
 * page from a detected challenge/deny page (AC3) and from a transport failure
 * (the generic "Page fetch failed").
 */

const FETCH_CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 45_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;
const RETRY_JITTER_FACTOR = 0.5;

/**
 * Discriminated result of a page fetch (design.md §fetchPage return type).
 *
 * - `ok`: the page loaded and `detectBlockedPage` found no challenge marker.
 * - `blocked`: the sidecar returned HTML, but it matches a known challenge /
 *   deny signature — no real content. `signature` is the registry id (e.g.
 *   `datadome-captcha`), surfaced in the failure reason.
 * - `null`: the transport itself failed after retries (network error, sidecar
 *   unreachable, non-JSON response). Callers map this to "Page fetch failed".
 */
export type FetchPageResult =
  | { kind: "ok"; html: string; url: string }
  | { kind: "blocked"; signature: string };

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
 * Resolve the sidecar base URL. `CAMOUFOX_SIDECAR_URL` is required in env, so a
 * missing value is a hard config error at first use (matching `DATABASE_PATH`,
 * AC5). Trailing slashes are stripped so `base + "/v1/fetch"` always works.
 */
function getSidecarBaseUrl(): string {
  const { CAMOUFOX_SIDECAR_URL } = getEnv();
  return CAMOUFOX_SIDECAR_URL.replace(/\/+$/, "");
}

/** Body shape of a successful sidecar fetch response. */
interface SidecarOkResponse {
  ok: true;
  html: string;
  url: string;
}

/** Body shape of a sidecar fetch failure response (the sidecar never throws). */
interface SidecarFailResponse {
  ok: false;
  reason: "blocked" | "fetch_failed";
}

/**
 * Outcome of a single sidecar attempt. `error` covers any transport-level
 * failure (network error, non-2xx status, non-JSON body, timeout) so the retry
 * loop can back off and try again. The sidecar itself classifies anti-bot
 * blocks as `{ ok: false, reason: "blocked" }`, but we still run
 * `detectBlockedPage` on an `ok` HTML payload below to cover edge cases where
 * the sidecar returns the challenge HTML verbatim (design.md §orchestration).
 */
type FetchAttempt =
  | { kind: "ok"; html: string; url: string }
  | { kind: "blocked"; reason: string }
  | { kind: "error"; message: string };

/**
 * Perform a single sidecar fetch. POST `CAMOUFOX_SIDECAR_URL + /v1/fetch` with
 * a 45 s timeout. Never throws: any failure (network error, non-JSON,
 * non-2xx, timeout, schema mismatch) is mapped to `{ kind: "error" }` so the
 * retry loop owns all backoff decisions.
 */
async function attemptSidecarFetch(url: string): Promise<FetchAttempt> {
  const endpoint = `${getSidecarBaseUrl()}/v1/fetch`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        kind: "error",
        message: `sidecar HTTP ${response.status} ${response.statusText}`,
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: "error", message: `sidecar non-JSON response: ${message}` };
    }

    // Validate the payload shape defensively — a misbehaving sidecar must not
    // crash the pipeline.
    if (
      payload &&
      typeof payload === "object" &&
      (payload as { ok?: unknown }).ok === true
    ) {
      const ok = payload as SidecarOkResponse;
      if (typeof ok.html === "string" && typeof ok.url === "string") {
        return { kind: "ok", html: ok.html, url: ok.url };
      }
    }

    if (
      payload &&
      typeof payload === "object" &&
      (payload as { ok?: unknown }).ok === false
    ) {
      const fail = payload as SidecarFailResponse;
      const reason = typeof fail.reason === "string" ? fail.reason : "unknown";
      if (reason === "blocked") {
        // The sidecar itself flagged an anti-bot block (it never throws).
        // The signature registry is the source of truth for the canonical id,
        // but the sidecar reports blocked without HTML, so we surface the
        // sidecar's reason as the signature and let the caller map it to the
        // specific anti-bot message.
        return { kind: "blocked", reason };
      }
      // `fetch_failed` (or any other reason) is a transport-level failure —
      // map to `error` so the retry loop owns backoff, and callers surface
      // "Page fetch failed" rather than a misleading anti-bot message.
      return { kind: "error", message: `sidecar fetch failed (${reason})` };
    }

    return { kind: "error", message: "sidecar returned an unexpected payload" };
  } catch (error) {
    // Never throw: map network / timeout / abort errors so the retry loop
    // owns backoff and structured logging (attempt number included there).
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "error", message };
  }
}

/**
 * Fetch a product page via the Camoufox sidecar.
 *
 * Returns `null` when the transport ultimately fails after retries (so callers
 * map it to "Page fetch failed"), or a `blocked` variant when a challenge/deny
 * page was detected (AC3: a specific anti-bot reason, never "Page fetch
 * failed").
 *
 * Anti-bot challenges are evaluated per request, so a `blocked` result whose
 * signature is `retryable` (behavioral challenges, captchas, managed
 * challenges) is retried with a fresh page and backoff — confirmed live
 * 2026-08-08: farmers.co.nz's Akamai behavioral challenge passes ~55% of
 * fresh attempts, so retrying lifts the effective success rate well above the
 * single-attempt pass rate. Final deny signatures (`retryable: false`) return
 * immediately.
 */
export async function fetchPage(
  url: string,
  options: FetchPageOptions = {},
): Promise<FetchPageResult | null> {
  return pageFetchLimiter(async () => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const result = await attemptSidecarFetch(url);

      if (result.kind === "ok") {
        // Run the generic anti-bot signature check on the returned HTML so a
        // challenge page the sidecar delivered verbatim is still caught
        // (design.md §orchestration). A non-null signature short-circuits to
        // the specific blocked reason; otherwise this is a real page.
        const signature = detectBlockedPage(result.html);
        if (signature) {
          if (isBlockedSignatureRetryable(signature) && attempt < MAX_RETRIES) {
            logger.warn("Page blocked by anti-bot WAF; retrying with a fresh fetch", {
              url,
              signature,
              attempt,
              productId: options.productId,
            });
            await sleep(calculateBackoffDelay(attempt));
            continue;
          }
          return { kind: "blocked", signature };
        }
        return { kind: "ok", html: result.html, url: result.url };
      }

      if (result.kind === "blocked") {
        // The sidecar itself flagged an anti-bot block (it never throws). The
        // sidecar reports blocked without HTML, so use its reason as the
        // signature — callers map it to the specific anti-bot message (AC3).
        const retryable = isBlockedSignatureRetryable(result.reason);
        logger.warn("Page blocked by anti-bot challenge (sidecar)", {
          url,
          reason: result.reason,
          retryable,
          attempt,
          productId: options.productId,
        });
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(calculateBackoffDelay(attempt));
          continue;
        }
        return { kind: "blocked", signature: result.reason };
      }

      // result.kind === "error" — already logged inside attemptSidecarFetch.
      logger.warn("Page fetch sidecar error", {
        url,
        error: result.message,
        attempt,
        productId: options.productId,
      });

      if (attempt < MAX_RETRIES) {
        const delay = calculateBackoffDelay(attempt);
        await sleep(delay);
        continue;
      }

      logger.error("Page fetch failed after retries", {
        url,
        error: result.message,
        productId: options.productId,
      });
      return null;
    }

    return null;
  });
}
