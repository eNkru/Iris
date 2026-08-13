# Slow down OpenCode Zen extraction so free-tier rate limits stop failing checks

## Goal

Price extraction against OpenCode Zen (`deepseek-v4-flash-free`) currently bursts the free-tier quota. Slow Zen calls so a scheduler tick or add-product succeeds even if each extraction takes a few extra seconds.

## Background

Farmers / Akamai failures in the same logs are a separate problem. This task only covers the confirmed Zen 429 path: the page was already fetched (`path: preloaded-html`) and `aiExtractPrice` then failed.

### Confirmed cause

`.env` points at `AI_BASE_URL=https://opencode.ai/zen/v1` and `AI_MODEL=deepseek-v4-flash-free`.

There is **no limiter around `generateText`**. The burst comes from three layers stacking:

| Layer | File | What it does |
| --- | --- | --- |
| Scheduler | `packages/prices/src/scheduler/scheduler.ts:26-27,99` | `DEFAULT_CONCURRENCY = 5` — five `checkPrice` in parallel |
| Page fetch | `packages/prices/src/pipeline/fetch-page.ts:30,69` | its own `pLimit(5)` — unrelated to Zen |
| AI extract | `packages/prices/src/pipeline/ai-extract.ts:211,279-305` | one `generateText` per product, no `pLimit`, no 429 retry |
| SDK retry | Vercel AI SDK default | error text `Failed after 3 attempts. Last error: Error from provider (Console): Rate limit exceeded` |

Live evidence (`iris-app-1`, 2026-08-12):

- 23:38 tick: Bunnings, PB Tech, Farmers Lego/Breville all hit Zen 429 within ~13 s (`processed:5`, `concurrency:5`).
- 23:51 add-product Delonghi: Camoufox `POST /v1/fetch` 200, no Akamai signature, then the same Zen 429, then `Product create rolled back after failed first check`.

`performance.md:50-141` already requires a shared limiter plus 429 exponential backoff. Extraction does not implement either.

### Why lowering scheduler concurrency is not enough

`checkPrice` also runs from add-product / check-now. A limiter only on the scheduler would leave those paths unbounded. The throttle belongs on `generateText`.

## Requirements

- R1: All `generateText` calls in `aiExtractPrice` (preloaded-html and fetch-tool) share one process-wide limiter. Default: 1 in-flight Zen request.
- R2: After a successful or failed Zen call, wait a small gap (default 2 s) before the next call starts. Operator accepts extra seconds of latency.
- R3: On provider 429 / `Rate limit exceeded`, retry with exponential backoff + jitter (existing `performance.md` pattern, max 3 attempts) instead of failing the check on the first 429.
- R4: Page-fetch concurrency stays at 5. Camoufox may still fetch in parallel; only the Zen call queues.
- R5: Defaults are env-tunable (`AI_EXTRACT_CONCURRENCY`, `AI_EXTRACT_MIN_INTERVAL_MS`). No admin UI in this task.
- R6: Failures still never throw out of `aiExtractPrice`. Exhausted retries log and return `null` so the pipeline records `Price extraction failed`.

## Acceptance Criteria

- [ ] AC1: Two overlapping `aiExtractPrice` calls issue the second `generateText` only after the first finishes and the min interval has elapsed.
- [ ] AC2: A simulated 429 on attempt 1 is retried and can succeed; the log includes `Rate limited, retrying` with attempt and delay.
- [ ] AC3: A scheduler tick of 5 due products still fetches pages concurrently (Camoufox `pLimit(5)` unchanged) but never has more than one in-flight Zen request.
- [ ] AC4: Add-product of a page that already fetches successfully no longer fails solely because five other extracts fired in the same second.
- [ ] AC5: `pnpm typecheck` and `pnpm lint` pass. Existing fetch / blocked-signature tests stay green.

## Out of scope

- Akamai fingerprint / Linux-only Camoufox fonts / restoring Windows fonts.
- Changing Camoufox `os="linux"`, fetch timeout, or retryable WAF signatures.
- Switching off `deepseek-v4-flash-free` or adding a paid model.
- Admin UI for the new knobs.
- Changing `DEFAULT_CONCURRENCY` / `DEFAULT_BATCH_SIZE` / poll interval.

## Technical notes

- Pattern to copy: `telegram.ts:17-21` module-level `pLimit`, plus `performance.md:104-172` 429 backoff.
- Wrap both `extractFromPageContent` and `extractWithFetchTool` at the `generateText` call site (or one helper used by both).
- Detect 429 from SDK error `status` / `code` **and** the `"Rate limit exceeded"` message (Zen's `Console` wrapper may not set 429 on the outer error).
- Do not serialize `fetchPage`. A 5-product tick should still overlap Camoufox navigations.

## Risks

- A 5-product tick becomes ~5 × (Zen latency + 2 s) for the extract phase. Acceptable per operator.
- If the free-tier quota is a rolling per-minute cap already exhausted, backoff still waits; it cannot create quota. After a cool-down the throttle should keep Iris under the cap.
