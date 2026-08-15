import { logger } from "@iris/utils";

/**
 * Shared retry / exponential-backoff / jitter helper for outbound fetches
 * (page fetch, image download, future outbound HTTP). Replaces the
 * previously inlined `calculateBackoffDelay` + `sleep` pair in
 * `fetch-page.ts` so the two retry loops stay in lockstep and future
 * outbound calls can reuse it.
 *
 * The caller's `fn` throws on failure. Whether to retry is delegated to
 * `shouldRetry(error, attempt)`, which returns `{ retry: true }` to
 * back off and re-invoke `fn`, or `{ retry: false }` to surface the
 * error unchanged. This is more flexible than a hard-coded predicate on
 * `Error` because the image-fetch path needs to retry on 5xx but NOT on
 * a schema mismatch — both caught at the HTTP layer in the same `try`.
 *
 * `attempt` is 1-indexed. The loop runs at most `maxRetries` times.
 */

export type RetryDecision =
  | { retry: true }
  | { retry: false };

export interface ShouldRetryContext {
  /** 1-indexed attempt number that just failed. */
  attempt: number;
  /** Maximum attempts the helper is allowed to make. */
  maxRetries: number;
}

export interface RetryWithBackoffOptions {
  /** Maximum number of attempts (1-indexed). Must be >= 1. */
  maxRetries: number;
  /** Base delay in ms for attempt = 1. */
  baseMs: number;
  /** Hard cap on the per-attempt delay in ms. */
  maxMs: number;
  /**
   * Jitter factor in [0, 1]: delay is `capped * (1 + jitter * random())`.
   * `0` => deterministic (no jitter), `0.5` => typical. Default `0.5`.
   */
  jitter?: number;
  /**
   * Predicate that decides whether to retry after `fn` threw. Receives
   * the error plus a context with the 1-indexed `attempt` number and
   * the caller's `maxRetries` budget.
   */
  shouldRetry: (error: unknown, ctx: ShouldRetryContext) => RetryDecision | Promise<RetryDecision>;
  /**
   * Optional callback fired when `shouldRetry` returned `{ retry: true }`.
   * Receives the error, the 1-indexed attempt, and the next delay in ms.
   * Defaults to a structured warning log.
   */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryWithBackoffOptions,
): Promise<T> {
  const jitter = opts.jitter ?? 0.5;
  const { maxRetries } = opts;

  if (maxRetries < 1) {
    throw new Error("retryWithBackoff: maxRetries must be >= 1");
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      const decision = await opts.shouldRetry(error, { attempt, maxRetries });

      if (!decision.retry || attempt >= maxRetries) {
        throw error;
      }

      const delay = calculateBackoffDelay(attempt, opts.baseMs, opts.maxMs, jitter);

      if (opts.onRetry) {
        opts.onRetry(error, attempt, delay);
      } else {
        logger.warn("Retrying after error", {
          attempt,
          delayMs: Math.round(delay),
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await sleep(delay);
    }
  }

  // Unreachable: the loop always returns or throws on the terminal attempt.
  /* c8 ignore next */
  throw new Error("retryWithBackoff: exited loop without resolution");
}

function calculateBackoffDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  jitter: number,
): number {
  const exponential = baseMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, maxMs);
  return capped + capped * jitter * Math.random();
}

/** Public backoff helper exposed for legacy callers that manage their own loop
 *  (e.g. `fetch-page.ts`'s anti-bot-challenge retry that interleaves a
 *  non-throwing `kind: "blocked"` path with throwing error paths). */
export function backoffDelayMs(attempt: number): number {
  return calculateBackoffDelay(attempt, 1_000, 30_000, 0.5);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
