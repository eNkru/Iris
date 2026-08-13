# AI SDK Backend Integration Guidelines

## 1. Overview

This document covers backend integration patterns using the Vercel AI SDK (`ai`
package) for AI-powered features.

### Single provider model: generic OpenAI-compatible

Iris uses **one** generic OpenAI-compatible provider. The operator configures a
**base URL**, an **API key**, and a **model** — all stored in `global_settings`
(admin-editable at runtime) with env fallbacks for seeding / first boot. Any
OpenAI-compatible endpoint works: OpenAI, OpenRouter, OpenCode Zen, a local
Llama/Ollama server, etc.

There is no provider enum and no per-provider switch. Everything routes through
`@ai-sdk/openai-compatible`'s `createOpenAICompatible`.

### Package Dependencies

```bash
pnpm add ai @ai-sdk/openai-compatible
```

> **CRITICAL version pin**: `@ai-sdk/openai-compatible` must stay on the `0.2.x`
> line (e.g. `^0.2.16`). The `1.x` line pulls in `@ai-sdk/provider` v2 /
> `provider-utils` v3, which is incompatible with the `ai@4.x` installed here
> (LanguageModelV1). Check the pinned `ai` version before bumping any
> `@ai-sdk/*` package.

### Config resolution (DB → env fallback)

Config lives in `packages/utils/src/lib/env.ts` (`AI_BASE_URL`, `AI_API_KEY`,
`AI_MODEL`) as build-time defaults, and in `global_settings` (`aiBaseUrl`,
`aiApiKey`, `aiModel`) as instance-level overrides. The pipeline resolves
`globalSettings → env` in `resolveAiConfig`
(`packages/prices/src/pipeline/ai-extract.ts`). The API key is masked on read
(`maskSecret`, never returned in full by `GET /admin/global-settings`).

### Env Contract (additive, all optional — build-time fallbacks only)

```bash
AI_BASE_URL="https://api.openai.com/v1"   # any OpenAI-compatible endpoint
AI_API_KEY=""                              # empty → provider degrades to null
AI_MODEL="gpt-4o-mini"
# Optional extraction throttle (defaults shown). Process-wide; no admin UI.
# AI_EXTRACT_CONCURRENCY=1
# AI_EXTRACT_MIN_INTERVAL_MS=2000
```

## 1a. CRITICAL: `ai@4.x` + zod v4 incompatibility

> **Warning**: `ai@4.x` (`ai@4.3.19`) is NOT compatible with zod v4.
>
> The `zodSchema()` helper converts schemas through
> `zod-to-json-schema@3.25.2`, which only reads zod v3's `_def.typeName`.
> zod v4.4.3 moved that to `_def.type`, so **every** schema converts to an empty
> `{}` object (no `type: "object"`). Providers that strictly validate tool
> schemas (DeepSeek via Zen, etc.) then reject `generateObject` with:
>
> ```
> Invalid schema for function 'json': schema must be a JSON Schema of
> 'type: "object"', got 'type: null'.
> ```
>
> **Fix**: build the AI SDK `Schema` from zod v4's native `toJSONSchema()`
> instead of passing the zod schema directly. Keep output validation via the
> `validate` option. Pattern (see `packages/prices/src/pipeline/ai-extract.ts`):

```typescript
import { jsonSchema } from "ai";

function aiSchema() {
  return jsonSchema<PriceExtraction>(
    priceExtractionSchema.toJSONSchema({ target: "draft-07" }) as unknown as Parameters<
      typeof jsonSchema
    >[0],
    {
      validate: (value) => {
        const result = priceExtractionSchema.safeParse(value);
        return result.success
          ? { success: true, value: result.data }
          : { success: false, error: result.error };
      },
    },
  );
}
```

Tool `parameters` must also use the zod-v4-native `toJSONSchema` trick —
`tool()` routes parameters through the same broken `zodSchema()` path.

## 1b. Gotcha: thinking models reject `tool_choice`

Zen routes open-source models (e.g. `deepseek-v4-flash-free`) to DeepSeek,
whose **thinking mode** rejects the *required* `tool_choice` that
`generateObject`'s tool mode sends:

```
Error from provider (DeepSeek): Thinking mode does not support this tool_choice
```

**Fix (still required for any tool-using call)**: `generateText` with `tools`,
whose default `tool_choice` is `"auto"` — accepted by thinking models. Have the
model return strict JSON and validate it yourself with `priceExtractionSchema`
(see §1d). Iris no longer has a `generateObject` branch.

**Preferred production path** (used by `checkPrice`): the Camoufox sidecar has
already fetched the page. Pass that HTML into `aiExtractPrice` and run a
**single** no-tool `generateText` over the reduced page content. That also
avoids the multi-step `reasoning_content` failure in §1e.

## 1c. Gotcha: page truncation can hide the price

A naïve extraction path truncates raw HTML to fit the prompt (e.g. 40k chars).
Some sites (e.g. Bunnings NZ) emit megabytes of CSS-in-JS before the actual
price markup, so the truncated prompt contains no price → the model correctly
reports `available: false`. This is a pipeline/prompt characteristic, not an AI
bug.

Iris avoids this by reducing the page first (`reducePageHtml`): visible text
plus any embedded price JSON (React-Query/Next.js pages hydrate
`{"formattedValue":"$119.00","value":119}` into `<script>` blobs). No raw HTML
is put in the prompt. The reduction runs either on the preloaded HTML
(`checkPrice` → `aiExtractPrice({ html })`) or inside the optional `fetchPage`
tool fallback.

## 1d. Gotcha: a bare model call has NO web access

A model called through `/chat/completions` (what `createOpenAICompatible`
sends) cannot visit websites — it will honestly report *"I can't visit live
websites"*. This is **not** a model limitation: the OpenCode TUI works because
it wires up a `webfetch` tool.

Iris's primary path does **not** need the model to fetch: `checkPrice` already
fetched via the Camoufox sidecar and passes `html` into `aiExtractPrice`. The
`fetchPage` tool remains only as a fallback when no HTML is provided:

```typescript
import { generateText, tool, jsonSchema } from "ai";

// Fallback only — prefer preloaded HTML (see §1e).
const result = await generateText({
  model,
  maxSteps: 5, // must exceed 1, or the final answer after the tool call is dropped
  tools: {
    fetchPage: tool({
      description: "Fetch a web page and return a compact representation of its content.",
      parameters: jsonSchema<{ url: string }>(paramsSchema.toJSONSchema({ target: "draft-07" })),
      execute: async ({ url }) => reducePageHtml(await fetchText(url)),
    }),
  },
  prompt: "...call the fetchPage tool... Return ONLY a JSON object...",
});
```

- Tool `parameters` must use the zod-v4-native `toJSONSchema` trick (1a).
- Parse the strict JSON out of `result.text` and validate with
  `priceExtractionSchema.safeParse` yourself; `generateText` does not validate.
- Production checks use the preloaded-HTML path in `aiExtractPrice`
  (`packages/prices/src/pipeline/ai-extract.ts`).

## 1e. Gotcha: thinking models + multi-step tools drop `reasoning_content`

DeepSeek thinking mode (e.g. `deepseek-v4-flash-free` via Zen) returns
`reasoning_content` on every assistant turn. For multi-step tool use the API
**requires** that field to be passed back on subsequent requests
([Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)); omitting
it yields:

```
Error from provider (…): The `reasoning_content` in the thinking mode must be
passed back to the API.
```

`ai@4.x` multi-step `generateText` *does* keep reasoning parts on the internal
message list, but `@ai-sdk/openai-compatible@0.2.x`'s
`convertToOpenAICompatibleChatMessages` only re-encodes `text` + `tool-call`
parts — it drops `type: "reasoning"`. So step 2 of a tool loop fails against
DeepSeek.

**Fix used by Iris**: do not multi-step for price extraction. `checkPrice`
fetches once via Camoufox, then calls `aiExtractPrice({ html })` which runs a
single no-tool `generateText` over `reducePageHtml(html)`. The tool-based path
remains only as a fallback when HTML is not preloaded (and will still fail on
thinking models until the provider package re-encodes reasoning).

## 2. Provider construction

Build the model from the resolved config. Return `null` on an empty API key so
the pipeline degrades to a logged no-op instead of throwing.

```typescript
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

function createModel(config: ResolvedAiConfig): LanguageModel | null {
  if (config.apiKey === "") return null;
  return createOpenAICompatible({
    name: "iris",
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  })(config.model);
}
```

## 3. Basic Usage

### generateText (preloaded HTML — preferred Iris extraction path)

```typescript
import { generateText } from "ai";

// html already fetched by fetchPage / Camoufox sidecar
const result = await generateText({
  model,
  prompt: buildPageContentExtractionPrompt(url, reducePageHtml(html)),
});
// parse + priceExtractionSchema.safeParse(result.text)
```

### generateText (fetch-tool fallback — avoid with thinking models, §1e)

```typescript
import { generateText, tool, jsonSchema } from "ai";

const result = await generateText({
  model,
  maxSteps: 5,
  tools: { fetchPage: buildFetchPageTool() },
  prompt: buildToolExtractionPrompt(url),
  experimental_telemetry: {
    isEnabled: true,
    functionId: "prices.extract",
    metadata: { productId, url },
  },
});

const extraction = parseExtractionJson(result.text); // validates with priceExtractionSchema
```

### generateObject (structured output) — NOT used by Iris

`generateObject` is incompatible with thinking models (§1b) and puts raw HTML
in the prompt (§1c). Iris uses `generateText` + the `fetchPage` tool instead.
Only reach for `generateObject` if you add a feature whose model is known not
to be a thinking model AND whose input is already compact (not a web page).

## 4. Tool Calling

Define tools the model can invoke. Tool `parameters` MUST use the zod-v4
`toJSONSchema` trick (§1a). See `buildFetchPageTool` in `ai-extract.ts`.

```typescript
import { tool, jsonSchema } from "ai";
import { z } from "zod";

const paramsSchema = z.object({ url: z.string().url() });

const fetchPageTool = tool({
  description: "Fetch a web page and return a compact representation of its content.",
  parameters: jsonSchema<{ url: string }>(
    paramsSchema.toJSONSchema({ target: "draft-07" }) as unknown as Parameters<typeof jsonSchema>[0],
  ),
  execute: async ({ url }) => reducePageHtml(await fetchText(url)),
});
```

## 5. Telemetry Configuration

**IMPORTANT**: Always enable telemetry for token tracking and performance
monitoring.

```typescript
import { generateText } from "ai";

const result = await generateText({
  model,
  tools: { fetchPage },
  prompt,
  experimental_telemetry: {
    isEnabled: true,
    functionId: "prices.extract", // Module.function naming
    metadata: { productId, url },
  },
});
```

### Telemetry Naming Convention

Use dot-separated format for `functionId`: `module.function`

| Module | Example functionId |
|--------|-------------------|
| Prices | `prices.extract` |
| Support | `support.generateReply` |
| Content | `content.summarize` |

### Auto-recorded Metrics

| Metric | Description |
|--------|-------------|
| `ai.model.id` | Model identifier (e.g. gpt-4o-mini) |
| `ai.model.provider` | Provider name (e.g. iris) |
| `ai.usage.prompt_tokens` | Input tokens consumed |
| `ai.usage.completion_tokens` | Output tokens generated |
| `ai.usage.total_tokens` | Total tokens used |
| `ai.response.finish_reason` | Completion reason (stop, length, etc.) |

## 6. Error Handling

Never throw out of the AI path — every failure (missing key, AI error, schema
mismatch) is logged and `null` is returned so the pipeline records a failed
check instead of crashing.

### Scenario: Extraction throttle (shared limiter + 429 backoff)

#### 1. Scope / Trigger

Free-tier OpenCode Zen (`deepseek-v4-flash-free`) 429s when a scheduler tick
(`DEFAULT_CONCURRENCY = 5`) and add-product / check-now all fire
`generateText` in the same second. The throttle is an env-wired, process-wide
contract around every Zen call. Page fetch stays at `pLimit(5)`.

#### 2. Signatures

```ts
// packages/prices/src/pipeline/ai-extract.ts
const AI_EXTRACT_MAX_RETRIES = 3;

async function generateTextThrottled(
  options: Parameters<typeof generateText>[0],
  context: { productId?: string; url: string },
): Promise<GenerateTextResult>;
// always spreads `{ ...options, maxRetries: 0 }` then withAiLimit

async function withAiLimit<T>(
  fn: () => Promise<T>,
  context: { productId?: string; url: string },
): Promise<T>;
// pLimit(AI_EXTRACT_CONCURRENCY) → runWithMinIntervalAndRetry

// packages/utils/src/lib/env.ts
AI_EXTRACT_CONCURRENCY: z.coerce.number().int().positive().default(1)
AI_EXTRACT_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(2_000)
```

Limiter is created lazily on first use from `getEnv()` and cached for the
process. Mid-process env changes are ignored (boot-time knobs).

#### 3. Contracts

| Key | Required | Default | Constraint |
| --- | --- | --- | --- |
| `AI_EXTRACT_CONCURRENCY` | no | `1` | positive int; in-flight Zen calls |
| `AI_EXTRACT_MIN_INTERVAL_MS` | no | `2000` | nonnegative int; gap after each attempt (success or fail) |

No admin UI. Scheduler / add-product / check-now share one limiter.

`isRateLimitError`: `status === 429` or `code === 429` or `/rate limit/i` on
`message` (Zen's `Console` wrapper may not set 429 on the outer error).

Backoff: `2 ** attempt * 1000 + random * 1000`. Log
`Rate limited, retrying` with `operation: "aiExtractPrice"`, `productId`,
`url`, `attempt`, `delay` (rounded). 429 backoff holds the limiter slot.

Import `generateText` / `createOpenAICompatible` from `./ai-sdk`, not `ai`.
Vite externalizes `packages/prices/node_modules/ai`, so `vi.mock("ai")` is a
no-op and would hit the real provider.

#### 4. Validation & Error Matrix

| condition | generateText | log | `aiExtractPrice` |
| --- | --- | --- | --- |
| success | 1 call, `maxRetries: 0` | none | parsed extraction |
| 429 / `/rate limit/i`, attempt &lt; 3 | retry after backoff | `warn` `Rate limited, retrying` | continue |
| 429 exhausted (3 attempts) | throw to outer catch | existing `error` `AI price extraction failed` | `null` |
| non-429 error | no retry | existing `error` | `null` |
| overlapping extracts | second waits for first + min interval | none | both succeed if each call does |

#### 5. Good / Base / Bad

- **Good**: two overlapping extracts → `maxInFlight === 1`; second
  `generateText` starts only after first ends + `AI_EXTRACT_MIN_INTERVAL_MS`.
- **Base**: first call 429, second succeeds → 2 `generateText` calls; warn
  includes `attempt: 1` and `delay` in `[2000, 3000)` for attempt 1.
- **Bad**: leave SDK `maxRetries` at default 2 → three immediate Zen hits
  before our backoff (`Failed after 3 attempts. Last error: Rate limit
  exceeded`). Do not serialize `fetchPage`.

#### 6. Tests Required

`tests/unit/ai-extract.test.ts` (mock `./ai-sdk`, set env before import,
`resetEnvCache()`):

- overlapping extracts: `maxInFlight === 1`, start gap ≥ call duration +
  min interval, `generateText` called with `maxRetries: 0`.
- first-call 429 then success: 2 calls; warn has `attempt` + `delay`.

Do not lower `fetch-page.ts` / scheduler concurrency in these tests.

#### 7. Wrong vs Correct

```ts
// Wrong — SDK retries burst the quota before our limiter/backoff
await generateText({ model, prompt });

// Wrong — vi.mock("ai") is a no-op (package is Vite-externalized)
vi.mock("ai", () => ({ generateText: vi.fn() }));

// Correct — own retries; mock the local re-export
await generateTextThrottled({ model, prompt }, { productId, url });
// generateTextThrottled → generateText({ ...options, maxRetries: 0 })
vi.mock("../../packages/prices/src/pipeline/ai-sdk", () => ({ generateText, ... }));
```

```typescript
async function extractPrice(url: string, config: ResolvedAiConfig, productId?: string) {
  const model = createModel(config);
  if (!model) {
    logger.warn("AI provider not configured (missing API key)", { productId, url });
    return null;
  }
  try {
    return await extractWithFetchTool(model, url, productId);
  } catch (error) {
    logger.error("AI price extraction failed", {
      model: config.model,
      productId,
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
```

### Common Error Types

| Error | Cause | Resolution |
|-------|-------|------------|
| Rate limit exceeded | Too many requests | Shared limiter (default 1) + min interval (default 2 s) + 429 backoff (max 3) in `aiExtractPrice` |
| Context length exceeded | Prompt too long | Use the fetch-tool path (compact reduction) |
| Invalid API key | Missing/wrong credentials | Set `AI_API_KEY` (env) or via admin UI |
| Schema validation failed | AI output doesn't match schema | Tighten `buildToolExtractionPrompt` |
| Thinking mode does not support this tool_choice | Used `generateObject` with tools | Use `generateText` (§1b) |

## 7. Prompt Engineering

### XML structure for complex prompts

```typescript
const prompt = `
<context>${contextData}</context>
<task>Extract key information.</task>
<output_format>Return a JSON object...</output_format>
`;
```

### Strict-JSON tool prompt (the Iris extraction shape)

```typescript
function buildToolExtractionPrompt(url: string): string {
  return `
Product URL: ${url}

Call the fetchPage tool to load the product page. The tool returns a compact
representation of the page content, including any embedded price data.

Extract the current selling price of the single product on this page, its
currency, and its name. If the page shows the product as out of stock, or no
price is visible anywhere in the page content, set "available" to false.

Return ONLY a single JSON object — no prose, no markdown — exactly matching
this shape:
{"price": 119, "currency": "NZD", "name": "Product name", "available": true}
`;
}
```

Parse + validate the response yourself (`parseExtractionJson` in `ai-extract.ts`).

## 8. Best Practices Summary

| Rule | Description |
|------|-------------|
| Always enable telemetry | Track token usage and performance for cost monitoring |
| Use the fetch-tool path | `generateText` + `fetchPage` tool; avoids truncation (1c) and works with thinking models (1b) |
| Throttle `generateText` | Shared limiter + min interval + 429 backoff + `maxRetries: 0`; do not serialize `fetchPage` |
| Validate model JSON yourself | `generateText` does not validate; use `priceExtractionSchema.safeParse` |
| Use the zod-v4 `toJSONSchema` trick | For tool `parameters` and any `jsonSchema()` (1a) |
| Handle errors gracefully | Return `null` on failure, never crash the pipeline |
| Log AI failures | Include model, productId, url, and error message |
| Pin `@ai-sdk/openai-compatible` to 0.2.x | 1.x is incompatible with `ai@4.x` |

## 9. Environment Variables

```bash
# Generic OpenAI-compatible config — build-time fallbacks (instance config
# is admin-editable in global_settings).
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=
AI_MODEL=gpt-4o-mini
# Optional: throttle generateText (defaults: 1 in-flight, 2 s gap).
# AI_EXTRACT_CONCURRENCY=1
# AI_EXTRACT_MIN_INTERVAL_MS=2000
```

There are no per-provider env vars (`OPENAI_API_KEY`, `GOOGLE_*`,
`ANTHROPIC_API_KEY`, `OPENCODE_*` are gone). To use a non-OpenAI model, point
`AI_BASE_URL` at an OpenAI-compatible gateway (OpenRouter, OpenCode Zen, a
local Ollama server, etc.).
