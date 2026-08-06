# Performance Patterns

This document covers performance optimization patterns for backend development.

## Parallel Execution with Promise.all

When operations are independent, execute them in parallel.

```typescript
// BAD - Sequential execution (slow)
const user = await getUser(userId);
const orders = await getOrders(userId);
const preferences = await getPreferences(userId);

// GOOD - Parallel execution
const [user, orders, preferences] = await Promise.all([
  getUser(userId),
  getOrders(userId),
  getPreferences(userId),
]);
```

### Promise.allSettled for Partial Failures

When some operations can fail without blocking others:

```typescript
const results = await Promise.allSettled([
  processOrderA(),
  processOrderB(),
  processOrderC(),
]);

const successful = results
  .filter((r): r is PromiseFulfilledResult<Order> => r.status === "fulfilled")
  .map(r => r.value);

const failed = results
  .filter((r): r is PromiseRejectedResult => r.status === "rejected")
  .map(r => r.reason);

logger.info("Batch processing complete", {
  successful: successful.length,
  failed: failed.length,
});
```

## Concurrency Control with p-limit

When calling external APIs, limit concurrent requests to avoid rate limiting.

```typescript
import pLimit from "p-limit";

// Create limiter with max 20 concurrent requests
const limit = pLimit(20);

const orderIds = ["order1", "order2", /* ... hundreds more */];

// Process all with controlled concurrency
const results = await Promise.all(
  orderIds.map(orderId =>
    limit(() => fetchOrderDetails(orderId))
  )
);
```

### Shared Limiter Pattern

For module-wide concurrency control:

```typescript
// lib/api-client.ts
import pLimit from "p-limit";

// External API concurrency limit
const API_CONCURRENCY = 20;

export function createApiLimiter(): ReturnType<typeof pLimit> {
  return pLimit(API_CONCURRENCY);
}

// Usage in procedure
const limiter = createApiLimiter();

const results = await Promise.allSettled(
  items.map(item =>
    limiter(async () => {
      try {
        const result = await externalApi.process(item);
        return { itemId: item.id, success: true, result };
      } catch (error) {
        return {
          itemId: item.id,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error"
        };
      }
    })
  )
);
```

## Rate Limit Retry with Exponential Backoff

Handle rate limits gracefully with automatic retry.

```typescript
const MAX_RETRIES = 3;

async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  context: { operation: string; itemId: string }
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isRateLimited = error?.code === 429 || error?.status === 429;

      if (isRateLimited && attempt < MAX_RETRIES) {
        // Exponential backoff: 2^attempt seconds + random jitter
        const delay = 2 ** attempt * 1000 + Math.random() * 1000;

        logger.warn("Rate limited, retrying", {
          operation: context.operation,
          itemId: context.itemId,
          attempt,
          delay: Math.round(delay),
        });

        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Failed after ${MAX_RETRIES} attempts`);
}

// Usage
const result = await fetchWithRetry(
  () => externalApi.getResource(resourceId),
  { operation: "getResource", itemId: resourceId }
);
```

### Backoff Configuration

```typescript
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;      // Base delay in ms
  maxDelay: number;       // Maximum delay cap
  jitterFactor: number;   // Random jitter (0-1)
}

const defaultConfig: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  jitterFactor: 0.5,
};

function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelay * 2 ** (attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelay);
  const jitter = cappedDelay * config.jitterFactor * Math.random();
  return cappedDelay + jitter;
}
```

## Redis Caching (Cache-Aside Pattern)

Implement caching for expensive operations.

```typescript
import { redis } from "../../../lib/redis";
import { SpanPrefix, span } from "../../../lib/tracer";

const CACHE_TTL = 3600; // 1 hour in seconds

interface CachedUserProfile {
  id: string;
  name: string;
  preferences: Record<string, unknown>;
}

async function getUserProfile(userId: string): Promise<CachedUserProfile> {
  const cacheKey = `user:profile:${userId}`;

  // 1. Try cache first
  const cached = await span(
    `${SpanPrefix.Redis}GetUserProfile`,
    async () => {
      const data = await redis.get<string>(cacheKey);
      return data ? JSON.parse(data) as CachedUserProfile : null;
    },
    { userId }
  );

  if (cached) {
    return cached;
  }

  // 2. Cache miss - fetch from database
  const profile = await span(
    `${SpanPrefix.DB}FetchUserProfile`,
    () => db.query.user.findFirst({
      where: eq(userTable.id, userId),
      with: { preferences: true },
    }),
    { userId }
  );

  if (!profile) {
    throw new ORPCError("NOT_FOUND", { message: "User not found" });
  }

  const cacheValue: CachedUserProfile = {
    id: profile.id,
    name: profile.name,
    preferences: profile.preferences,
  };

  // 3. Store in cache
  await span(
    `${SpanPrefix.Redis}SetUserProfile`,
    () => redis.set(cacheKey, JSON.stringify(cacheValue), { ex: CACHE_TTL }),
    { userId }
  );

  return cacheValue;
}
```

### Cache Invalidation

```typescript
async function updateUserProfile(
  userId: string,
  updates: Partial<UserProfile>
): Promise<void> {
  // 1. Update database
  await db.update(userTable)
    .set(updates)
    .where(eq(userTable.id, userId));

  // 2. Invalidate cache
  const cacheKey = `user:profile:${userId}`;
  await redis.del(cacheKey);

  logger.info("User profile updated and cache invalidated", { userId });
}
```

### Cache Key Patterns

```typescript
// User-specific data
`user:profile:${userId}`
`user:settings:${userId}`
`user:orders:${userId}:page:${page}`

// Resource-specific data
`product:${productId}`
`inventory:${warehouseId}:${productId}`

// Aggregated data
`stats:daily:${date}`
`leaderboard:${category}`
```

## Background Tasks with Distributed Locks

Prevent duplicate processing in distributed environments.

```typescript
const LOCK_KEY = "task:process-orders";
const LOCK_TTL = 300; // 5 minutes

async function processScheduledOrders(): Promise<void> {
  // 1. Try to acquire lock
  const lockResult = await redis.set(LOCK_KEY, Date.now(), {
    ex: LOCK_TTL,
    nx: true, // Only set if not exists
  });

  if (!lockResult) {
    logger.info("Another instance is processing orders, skipping");
    return;
  }

  try {
    // 2. Process with lock held
    logger.info("Acquired lock, processing scheduled orders");

    const pendingOrders = await db
      .select()
      .from(orderTable)
      .where(and(
        eq(orderTable.status, "SCHEDULED"),
        lte(orderTable.scheduledAt, new Date())
      ))
      .limit(100);

    for (const order of pendingOrders) {
      await processOrder(order);
    }

    logger.info("Scheduled orders processed", {
      count: pendingOrders.length
    });
  } finally {
    // 3. Release lock
    await redis.del(LOCK_KEY);
  }
}
```

### Lock with Heartbeat

For long-running tasks, extend the lock periodically:

```typescript
async function processLongRunningTask(): Promise<void> {
  const LOCK_KEY = "task:long-running";
  const LOCK_TTL = 30;
  const HEARTBEAT_INTERVAL = 10000; // 10 seconds

  const lockResult = await redis.set(LOCK_KEY, Date.now(), {
    ex: LOCK_TTL,
    nx: true,
  });

  if (!lockResult) {
    return;
  }

  // Heartbeat to extend lock
  const heartbeat = setInterval(async () => {
    await redis.expire(LOCK_KEY, LOCK_TTL);
  }, HEARTBEAT_INTERVAL);

  try {
    await doExpensiveWork();
  } finally {
    clearInterval(heartbeat);
    await redis.del(LOCK_KEY);
  }
}
```

## Batch Processing Patterns

### Chunked Processing

For large datasets, process in chunks:

```typescript
const CHUNK_SIZE = 100;

async function processAllOrders(orderIds: string[]): Promise<void> {
  // Split into chunks
  const chunks: string[][] = [];
  for (let i = 0; i < orderIds.length; i += CHUNK_SIZE) {
    chunks.push(orderIds.slice(i, i + CHUNK_SIZE));
  }

  logger.info("Processing orders in chunks", {
    totalOrders: orderIds.length,
    chunkCount: chunks.length,
    chunkSize: CHUNK_SIZE,
  });

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;

    await processOrderChunk(chunk);

    logger.info("Chunk processed", {
      chunkIndex: i + 1,
      totalChunks: chunks.length,
    });
  }
}

async function processOrderChunk(orderIds: string[]): Promise<void> {
  // Batch database query
  const orders = await db
    .select()
    .from(orderTable)
    .where(inArray(orderTable.id, orderIds));

  // Parallel processing with concurrency limit
  const limiter = pLimit(10);

  await Promise.all(
    orders.map(order => limiter(() => processOrder(order)))
  );
}
```

### Progress Reporting

Track and report progress for long operations:

```typescript
interface ProgressTracker {
  total: number;
  processed: number;
  failed: number;
  startTime: number;
}

async function batchProcessWithProgress(
  items: string[],
  progressCallback?: (progress: ProgressTracker) => void
): Promise<void> {
  const progress: ProgressTracker = {
    total: items.length,
    processed: 0,
    failed: 0,
    startTime: Date.now(),
  };

  const UPDATE_INTERVAL = 20; // Report every 20 items

  for (const item of items) {
    try {
      await processItem(item);
      progress.processed++;
    } catch {
      progress.failed++;
    }

    // Report progress periodically
    if ((progress.processed + progress.failed) % UPDATE_INTERVAL === 0) {
      progressCallback?.(progress);

      logger.info("Batch progress", {
        processed: progress.processed,
        failed: progress.failed,
        total: progress.total,
        elapsedMs: Date.now() - progress.startTime,
      });
    }
  }
}
```

## Page Fetch Transport for Bot-Protected Pages

Several major NZ retailers sit behind hard anti-bot challenges that a plain
HTTP client cannot pass: DataDome (kogan.com), Cloudflare managed challenge
(noelleeming.co.nz), and Akamai Bot Manager (farmers.co.nz). The price-
extraction pipeline fetches the product page first, so a blocked fetch surfaces
as the generic "Page fetch failed" and the create flow rolls the product row
back — the user cannot add these retailers at all.

### Strategy: Camoufox is the single fetch transport

Camoufox is an engine-level anti-detect Firefox fork (the Byparr engine); its
fingerprinting happens at the C++ engine level, not via JS patches. The
2026-08-04 spike proved a headless Camoufox pass every previously-blocked site
for free:

| Site | Plain Playwright | Camoufox (headless, free) |
|------|------------------|---------------------------|
| kogan.com (DataDome) | 403 / "Captcha Challenge" shell | 200 real PDP, price $199.98 |
| noelleeming.co.nz (Cloudflare) | 403 "Just a moment…" | 200 real PDP, price $917.00 |
| farmers.co.nz (Akamai) | /WAF_Deny_Page/ or Access Denied | 200 real PDP, $24.99 |

Strategy decision (user, 2026-08-04): **Camoufox is the only fetch transport.**
Playwright/Chromium is removed from the app entirely; there is no dual-path
orchestration. The browser runs in a separate sidecar container so the app
image stays small and browser crashes are isolated. The sidecar is a required
dependency in every environment (dev and prod): the app reads
`CAMOUFOX_SIDECAR_URL` (required in `env.ts`) and fails fast with a logged
error if the sidecar is unreachable (AC5).

Prior approaches evaluated and superseded:
- Plain Playwright Chromium (the old transport): fails Akamai product paths
  outright, and cannot pass DataDome/Cloudflare on the sites above.
- `playwright-extra` + `puppeteer-extra-plugin-stealth` (two rounds, 2026-08-04):
  free/local JS stealth changes the Akamai response (instant deny → behavioral
  challenge) but never delivers a real Farmers product page. Removed.
- TLS-impersonation (`wreq-js` chrome profile): Cloudflare scores a whole
  browser family as one class; profile rotation has a blind spot.
- Paid scraping API / residential proxy: was the documented next escalation
  after the stealth verdict, but Camoufox covers all three challenge classes
  for free, so no paid service is needed.

### Pattern: sidecar HTTP client with the shared limiter

`fetchPage` is a thin HTTP client for the sidecar. It no longer imports
Playwright or launches a browser. The operational envelope is preserved
exactly: the shared `pLimit(5)` (Shared Limiter Pattern), retry /
exponential-backoff / jitter (`MAX_RETRIES = 3`), and structured logging. The
sidecar holds ONE shared `AsyncCamoufox` browser and bounds its own concurrency
with an asyncio semaphore matching `FETCH_CONCURRENCY = 5`.

```typescript
// packages/prices/src/pipeline/fetch-page.ts (abridged)
export type FetchPageResult =
  | { kind: "ok"; html: string; url: string }
  | { kind: "blocked"; signature: string };

async function attemptSidecarFetch(url: string, opts: FetchPageOptions) {
  const response = await fetch(`${getSidecarBaseUrl()}/v1/fetch`, {
    method: "POST",
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), // 45 s
  });
  // map JSON {ok:true,html,url} | {ok:false,reason} | non-JSON/network → ok/blocked/error
}

export async function fetchPage(url: string, opts: FetchPageOptions) {
  return pageFetchLimiter(async () => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const result = await attemptSidecarFetch(url, opts);
      if (result.kind === "ok") {
        const signature = detectBlockedPage(result.html); // double-check returned HTML
        if (signature) return { kind: "blocked", signature };
        return { kind: "ok", html: result.html, url: result.url };
      }
      if (result.kind === "blocked") return { kind: "blocked", signature: result.reason };
      // error → backoff and retry; null on total failure
    }
    return null;
  });
}
```

### Anti-bot challenge/deny detection (shipped)

Because Camoufox is still a single transport (a regression on a site would have
no second path), `fetchPage` runs a **generic anti-bot signature check** on
every returned HTML before returning `ok`. A match short-circuits to the
`blocked` variant so `checkPrice` surfaces a specific anti-bot reason instead
of the generic "Page fetch failed" (AC3). The registry covers all challenge
classes confirmed live 2026-08-04. Real PDPs that only embed a Cloudflare
Turnstile widget (e.g. pbtech) contain `challenges.cloudflare.com/turnstile`
but are **not** challenge shells — the signature must not treat bare
`challenges.cloudflare.com` on large pages as a block (false positive fixed
2026-08-04).

```typescript
// packages/prices/src/pipeline/blocked-signatures.ts
const BLOCKED_SIGNATURES = [
  { id: "akamai-waf", test: (html) => html.includes("/WAF_Deny_Page/") },
  // title "Access Denied" + small HTML (edge block after soft home pass)
  { id: "akamai-access-denied", test: (html) => /* title + len < 5e3 */ },
  // intermediate behavioral challenge page (not a real PDP)
  { id: "akamai-behavioral-challenge", test: (html) =>
      html.includes("sec-if-cpt-container") && html.length < 20_000 },
  // DataDome captcha (kogan when the challenge is not solved)
  { id: "datadome-captcha", test: (html) => html.includes("captcha-delivery.com") },
  // Cloudflare managed-challenge shell only — NOT bare Turnstile embeds on
  // real PDPs (pbtech loads challenges.cloudflare.com/turnstile on a full page).
  { id: "cloudflare-challenge", test: (html) =>
      html.includes("_cf_chl_opt") || html.includes("cf-chl")
      || (html.length < 5_000 && (
           /just a moment/i.test(title)
           || html.includes("challenges.cloudflare.com")
         )) },
];
export function detectBlockedPage(html: string): string | null { ... }
```

```typescript
// packages/prices/src/pipeline/check-price.ts — after fetchPage
const page = await fetchPage(product.url, { productId });
if (!page) return { status: "failed", reason: "Page fetch failed" };       // transport
if (page.kind === "blocked") {
  logger.warn("Page blocked by anti-bot WAF", { productId, url, signature: page.signature });
  return { status: "failed", reason: `Anti-bot WAF deny page (${page.signature}) — …` };
}
// page.kind === "ok" → aiExtractPrice({ url: page.url, html: page.html, ... })
// Preloaded HTML: single generateText, no multi-step tool loop (ai-sdk §1e).
```

The registry is intentionally generic (id + predicate), not per-retailer code,
and the detection runs on every fetch (no hostname branching). The create flow
surfaces `check.reason`, so an operator sees "Anti-bot WAF deny page
(datadome-captcha) — …" instead of the generic text. Detection stays even
though Camoufox passes today: a clear failure beats a silent "unavailable",
and a regression on any site is visible, not silent.

### Required wiring

- `CAMOUFOX_SIDECAR_URL` is a required field in `packages/utils/src/lib/env.ts`
  (`z.string().url()`), matching `DATABASE_URL`'s hard-error behavior (AC5).
- `.env.example` documents it as required and notes local dev needs the
  sidecar (`docker compose up camoufox`).
- `fetch-page.ts` imports `getEnv` (from `@iris/utils`) to read the base URL;
  no Playwright import remains. `playwright` / `playwright-core` /
  `chromium-bidi` are removed from `@iris/prices` and `@iris/web` package.json,
  and from `apps/web/next.config.ts` `serverExternalPackages`.
- The app `Dockerfile` no longer runs `playwright install --with-deps`; browser
  deps live in the sidecar image (`camoufox/Dockerfile`).
- Keep the shared `pLimit` and structured logging wrapping the transport so
  observability is consistent across all fetches.

### Docker / sidecar deployment

The sidecar is a separate Compose service (`camoufox/`):

- `camoufox/Dockerfile`: `python:3.12-slim`, pip install `camoufox fastapi
  uvicorn`, `camoufox fetch` at build (browser cached into the image, offline
  at runtime), `CMD uvicorn`. Camoufox ships `linux/arm64` builds, so ARM NAS
  deployments work.
- `camoufox/server.py`: FastAPI app; lazy single `AsyncCamoufox` (headless)
  launched in the lifespan; asyncio semaphore (5); `POST /v1/fetch`; `GET
  /health`; fresh page per request; `goto` `domcontentloaded` (45 s); `content()`
  + `page.url()`; stdlib logging; never throws to the caller.
- `docker-compose.yml`: `camoufox` service (internal network only,
  `restart: unless-stopped`); app `depends_on: camoufox` (soft — `service_started`,
  so a slow sidecar start does not block the app from serving) and gets
  `CAMOUFOX_SIDECAR_URL=http://camoufox:8000`.

### Pattern: sidecar failure logging and degradation diagnostics

The sidecar (`camoufox/server.py`) is the single fetch transport, so a silent
shared-browser degradation is the worst-case failure mode: every retailer
returns `{ok:false, reason:"fetch_failed"}` and the app can only surface the
generic "Page fetch failed". Observed 2026-08-06 — after ~3 h of uptime the
shared `AsyncCamoufox` browser silently degraded and every `page.goto` raised.
The pre-fix code logged only `str(exc)` (no exception class) and the
`response is None` path logged nothing, so the root cause was invisible.

**Contract (code-spec)**: every failure path in `POST /v1/fetch` records a
structured WARNING with `error_type` (qualified exception class name) + `error`
(message) + `consecutive_failures` (running count), and exactly one richer
"browser degraded" summary at the threshold. The counter and threshold are
LOGGING-ONLY — no browser recreation, no `asyncio.Lock`, no teardown here
(that is the self-heal task's scope; this diagnostic fires at the same point
a future self-heal would trigger, so the logs map 1:1).

```python
# camoufox/server.py
DIAGNOSE_THRESHOLD = 3  # aligned with the self-heal task's HEAL_THRESHOLD
_consecutive_failures: int = 0  # module-level; logging-only

def _exc_type_name(exc: BaseException) -> str:
    cls = type(exc)
    module = getattr(cls, "__module__", "") or ""
    qualname = getattr(cls, "__qualname__", cls.__name__)
    return f"{module}.{qualname}" if module else qualname

def _record_failure(url: str, exc: BaseException | None, *, kind: str) -> None:
    # kind ∈ {"timeout", "error", "no_response"}; no_response has no exc object
    global _consecutive_failures
    _consecutive_failures += 1
    logger.warning("sidecar fetch %s", kind, extra={
        "url": url,
        "error": str(exc) if exc else "page.goto returned no response",
        "error_type": _exc_type_name(exc) if exc else kind,
        "consecutive_failures": _consecutive_failures,
    })
    # Rich summary (repr + traceback) fires ONCE at the threshold, not on
    # every transient timeout; suppressed for no_response (no exc to dump).
    if _consecutive_failures == DIAGNOSE_THRESHOLD and exc is not None:
        logger.warning("sidecar browser degraded — …", extra={..., "traceback": ...})

def _record_success() -> None:
    global _consecutive_failures
    _consecutive_failures = 0  # any successful fetch clears the trend
```

Handler routing (all paths return the SAME response bodies — no API change):

```python
# /v1/fetch
if response is None:
    _record_failure(request.url, None, kind="no_response")  # R3: was silent
    return FetchResponseFail(reason="fetch_failed")
# ... response.ok path ...
_record_success()  # non-2xx challenge/deny pages are per-site, NOT degradation
return FetchResponseOk(html=html, url=final_url)
except asyncio.TimeoutError as exc:
    _record_failure(request.url, exc, kind="timeout")
    return FetchResponseFail(reason="fetch_failed")
except Exception as exc:  # noqa: BLE001 — never throw to the caller
    _record_failure(request.url, exc, kind="error")  # new_page()/goto failures
    return FetchResponseFail(reason="fetch_failed")
```

**Validation & error matrix**

| condition | log | response | counter |
|---|---|---|---|
| `response.ok` (incl. non-2xx challenge HTML) | (non-2xx WARNING only) | `FetchResponseOk` | reset → 0 |
| `response is None` | WARNING `no_response` | `FetchResponseFail` | +1 |
| `asyncio.TimeoutError` | WARNING `timeout` (+`error_type`) | `FetchResponseFail` | +1 |
| any other `Exception` | WARNING `error` (+`error_type`) | `FetchResponseFail` | +1 |
| count reaches `DIAGNOSE_THRESHOLD` (3) with exc | +1 rich "degraded" summary w/ traceback | (unchanged) | keeps counting |

**Good/Base/Bad cases**

- **Good**: 1 timeout then a success → counter resets to 0; no degraded line.
- **Base**: 3 consecutive `goto` errors → exactly one "browser degraded" line with traceback; 4th failure logs per-request line only (no re-emit until reset).
- **Bad (pre-fix)**: `response is None` silent; `error` logged as bare message with no class → root cause invisible after hours of uptime.

**Tests required** (assertion points)

- Per-request failure line carries `error_type` = qualified class name (e.g. `playwright.async_api.Error`), not just the message.
- `response is None` emits a WARNING (previously silent).
- Counter increments `1→2→3→4` across consecutive failures; `_record_success` resets to 0.
- Exactly one "browser degraded" summary at count == 3; none at 4; none for `no_response` (exc is None).
- `/v1/fetch` and `/health` responses byte-identical to pre-change for ok / non-2xx / timeout / error.
- `git diff --stat` touches only `camoufox/server.py`.

**Wrong vs Correct**

```python
# Wrong — bare message, silent no-response path, no trend
except Exception as exc:  # noqa: BLE001
    logger.warning("sidecar fetch error", extra={"url": request.url, "error": str(exc)})
    return FetchResponseFail(reason="fetch_failed")
# response is None → return FetchResponseFail(reason="fetch_failed")  # no log at all

# Correct — type + message + counter; no-response accounted; threshold summary
except Exception as exc:  # noqa: BLE001
    _record_failure(request.url, exc, kind="error")
    return FetchResponseFail(reason="fetch_failed")
```

**Gotcha**: the sidecar runs Python stdlib `logging`, NOT the app's TS
`@iris/utils` logger. The backend `logging.md` `console.log` ban and TS logger
API do not apply here — match the existing `logger.warning(..., extra={...})`
style in `server.py`. Deps (fastapi/playwright/camoufox) exist only in the
container image; host-side unit tests must stub them to exercise the pure
`_record_failure` / `_record_success` / `_exc_type_name` helpers.

### Local dev

`pnpm dev` requires the sidecar. Run `docker compose up camoufox` (or a local
venv running `uvicorn server:app`) before starting the app. The README and
`.env.example` note this. With the sidecar on `http://localhost:8000`, local
dev and the in-container URL both work.

### Anti-pattern: retailer-specific code

Do NOT add a per-retailer branch like "if the URL contains pbtech.co.nz, use
transport X". The single Camoufox transport handles every retailer the same
way; any future anti-bot-protected site benefits automatically. There is no
URL allowlist and no per-hostname code path. The same rule applies to anti-bot
layers: WAF-deny detection is applied **globally** to every fetch, never keyed
off a hostname.

## Memory Optimization

### Streaming Large Datasets

For very large datasets, use streaming:

```typescript
async function* streamOrders(userId: string): AsyncGenerator<Order> {
  let cursor: string | undefined;
  const PAGE_SIZE = 100;

  while (true) {
    const orders = await db
      .select()
      .from(orderTable)
      .where(and(
        eq(orderTable.userId, userId),
        cursor ? gt(orderTable.id, cursor) : undefined
      ))
      .orderBy(asc(orderTable.id))
      .limit(PAGE_SIZE);

    if (orders.length === 0) {
      break;
    }

    for (const order of orders) {
      yield order;
    }

    const lastOrder = orders[orders.length - 1];
    cursor = lastOrder?.id;

    if (orders.length < PAGE_SIZE) {
      break;
    }
  }
}

// Usage
for await (const order of streamOrders(userId)) {
  await processOrder(order);
}
```
