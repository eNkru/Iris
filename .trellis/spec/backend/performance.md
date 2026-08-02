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

Some retailers (e.g. Cloudflare-proxied shops like `pbtech.co.nz`,
`thewarehouse.co.nz`) sit behind a Managed Security Challenge that not only
fingerprints the HTTP/2 + TLS client but also serves a JavaScript challenge
(`_cf_chl_opt`, `cType: 'managed'`) that must be executed to solve. Node's
native `fetch` (undici) is flagged → `403`/`503`, and the page is never
delivered; the price-extraction pipeline then fails on "Page fetch failed" and
the create flow rolls the product row back.

A TLS-impersonation fallback (the prior `wreq-js` with a `chrome_*` profile) is
**not robust enough**: Cloudflare scores an entire browser family (all
`chrome_*` versions) as a single class, so sites like thewarehouse reject every
Chrome-family profile while accepting Firefox/Safari. Profile rotation adds
complexity and still has a blind spot the next time Cloudflare adjusts its
scoring. The only universally-compatible transport is a **real headless
browser that executes the challenge JavaScript**.

### Pattern: single Playwright headless Chromium transport

`fetchPage` uses one transport — Playwright `chromium` — for every fetch. There
is no undici primary path and no per-retailer branch. The browser is launched
**once per process** and shared across all `fetchPage` calls; each call creates
a fresh `context` + `page` (so cookies / storage do not leak between retailers)
and disposes them in a `finally`. The shared `pLimit` and the retry /
exponential-backoff / structured-logging envelope are preserved unchanged.

```typescript
// packages/prices/src/pipeline/fetch-page.ts (abridged)
let browserPromise: Promise<import("playwright").Browser> | null = null;

async function getBrowser(): Promise<import("playwright").Browser> {
  if (browserPromise === null) {
    browserPromise = (async () => {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true, timeout: 60_000 });
      process.once("beforeExit", () => void browser.close().catch(() => {}));
      return browser;
    })();
  }
  return browserPromise;
}

async function attemptPlaywrightFetch(url: string, opts: FetchPageOptions) {
  const browser = await getBrowser();
  const context = await browser.newContext();   // fresh per call
  const page = await context.newPage();
  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: FETCH_TIMEOUT_MS,
    });
    if (!response?.ok()) return { kind: "status", status: response?.status() ?? 0 };
    return { kind: "ok", html: await page.content(), url: page.url() };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

export async function fetchPage(url: string, opts: FetchPageOptions) {
  return pageFetchLimiter(async () => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const result = await attemptPlaywrightFetch(url, opts);
      if (result.kind === "ok") return { html: result.html, url: result.url };
      // ... normal backoff / retry / null on total failure
    }
    return null;
  });
}
```

### Choice of browser library

`playwright` (Microsoft, MIT) is the chosen library: first-party, supports
Node 22, the `chromium` channel is the most predictable across glibc / musl
deployments, and the API surface is tiny (`newContext` + `newPage` + `goto`
+ `content` + `close`). `playwright-core` + `@playwright/browser-chromium` is
the equivalent split; this repo just depends on `playwright` directly.

Rejected alternatives: pure TLS-profile rotation (insufficient — one browser
family is a single scoring class), Puppeteer (less predictable across
deployments), CAPTCHA-solving service (cost, third-party dependency, ToS risk).

### Required wiring

- `playwright` is a direct dependency of both `@iris/prices` (the package that
  imports it) and `@iris/web` (so pnpm symlinks it into `apps/web/node_modules/`
  for the Next.js server bundle to resolve at runtime). Pin the same exact
  version in both `package.json` files (e.g. `1.49.1`) — a mismatch causes
  two browser binaries to be downloaded.
- Add `playwright` and `playwright-core` to `apps/web/next.config.ts`
  `serverExternalPackages` so webpack leaves the dynamic `import("playwright")`
  as a runtime `require()` / `import()` that Node resolves from `node_modules`.
  **Do NOT use an `IgnorePlugin` / `beforeResolve` returning `false`** — that
  makes webpack emit a stub that throws `"Cannot find module"` at runtime
  instead of leaving the module external.
- `apps/web/tsconfig.json` excludes `next.config.ts` from the app's
  `tsc --noEmit`; Next compiles the file itself with webpack in scope.
- Keep the shared `pLimit` and structured logging wrapping the transport so
  observability is consistent across all fetches.

### Docker image (glibc, not musl)

Playwright's chromium build is linked against **glibc** and cannot run on
Alpine/musl. The `Dockerfile` uses `node:22-bookworm-slim` (Debian) and runs
`pnpm --filter @iris/prices exec playwright install --with-deps chromium` at
image-build time. `--with-deps` runs `apt-get` to install the runtime libraries
(nss, freetype, harfbuzz, fontconfig, etc.) and downloads the matching
chromium binary into `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` so the app can
launch it offline at runtime.

### Anti-pattern: retailer-specific code

Do NOT add a per-retailer branch like "if the URL contains pbtech.co.nz, use
transport X". The single Playwright transport handles every retailer the same
way; any future Cloudflare-proxied site benefits automatically. There is no
URL allowlist and no per-hostname code path.

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
