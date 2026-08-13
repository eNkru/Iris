# Design — throttle OpenCode Zen extraction

## Boundaries

Only `packages/prices/src/pipeline/ai-extract.ts` changes. Callers (`check-price.ts`, scheduler, add-product RPC) stay the same. Camoufox / `fetch-page.ts` stay at `pLimit(5)`.

```
checkPrice (×N, scheduler pLimit 5)
  └─ fetchPage          ← still parallel
  └─ aiExtractPrice
       └─ withAiLimit   ← NEW: 1 in-flight + min interval + 429 backoff
            └─ generateText → Zen
```

## Contract

New module-level helper in `ai-extract.ts`:

```ts
const AI_EXTRACT_CONCURRENCY = Number(process.env.AI_EXTRACT_CONCURRENCY ?? 1);
const AI_EXTRACT_MIN_INTERVAL_MS = Number(process.env.AI_EXTRACT_MIN_INTERVAL_MS ?? 2000);

const aiExtractLimiter = pLimit(AI_EXTRACT_CONCURRENCY);

async function withAiLimit<T>(fn: () => Promise<T>): Promise<T> {
  return aiExtractLimiter(() => runWithMinIntervalAndRetry(fn));
}
```

`extractFromPageContent` and `extractWithFetchTool` wrap their `generateText` in `withAiLimit`. `aiExtractPrice`'s outer try/catch is unchanged (never throws).

### Min interval

Track `lastZenCallEndedAt`. After each attempt (success or fail), the next starter waits until `now - lastZenCallEndedAt >= AI_EXTRACT_MIN_INTERVAL_MS`. This is a gap between calls, not a sleep inside a successful call.

### 429 retry

Inside the limiter slot, retry `generateText` up to 3 times when the error is a rate limit:

- `error.status === 429` or `error.code === 429`, or
- `String(error.message)` matches `/rate limit/i`

Backoff: `2 ** attempt * 1000 + random * 1000` (same formula as `performance.md:122-123`). Log `Rate limited, retrying` with `attempt`, `delay`, `productId`, `url`. Non-429 errors throw immediately to the existing catch.

## Compatibility

- No schema / API / env-required change. New env vars are optional with defaults.
- Manual add-product and scheduler share the same limiter (process-wide), so a tick and a create cannot stampede Zen together.

## Tradeoffs

| Option | Why not |
| --- | --- |
| Lower `DEFAULT_CONCURRENCY` to 1 | Serializes Camoufox too; add-product bypasses it |
| Sleep 2 s before every call, no limiter | Two overlapping creates still burst |
| Only retry 429, no limiter | First wave of 5 still trips the cap |
| Paid Zen / different model | Operator asked to slow down, not switch provider |

Limiter + gap + 429 retry is the minimum that matches the existing `performance.md` patterns and the operator's "a few seconds is fine".

## Rollback

Revert the `ai-extract.ts` helper. No migration, no image rebuild required for the code change itself (image rebuild only if deploying).
