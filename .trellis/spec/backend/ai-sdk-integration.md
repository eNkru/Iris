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

**Fix (the path Iris uses everywhere)**: `generateText` with `tools`, whose
default `tool_choice` is `"auto"` — accepted by thinking models. Have the model
return strict JSON and validate it yourself with `priceExtractionSchema` (see
§1d). Iris no longer has a `generateObject` branch — the fetch-tool path is the
single extraction path.

## 1c. Gotcha: page truncation can hide the price

A naïve extraction path truncates raw HTML to fit the prompt (e.g. 40k chars).
Some sites (e.g. Bunnings NZ) emit megabytes of CSS-in-JS before the actual
price markup, so the truncated prompt contains no price → the model correctly
reports `available: false`. This is a pipeline/prompt characteristic, not an AI
bug.

Iris avoids this entirely: the model fetches the page itself via the
`fetchPage` tool (§1d), which returns a compact reduction — visible text plus
any embedded price JSON (React-Query/Next.js pages hydrate
`{"formattedValue":"$119.00","value":119}` into `<script>` blobs). No raw HTML
is put in the prompt.

## 1d. Gotcha: a bare model call has NO web access

A model called through `/chat/completions` (what `createOpenAICompatible`
sends) cannot visit websites — it will honestly report *"I can't visit live
websites"*. This is **not** a model limitation: the OpenCode TUI works because
it wires up a `webfetch` tool. To give a model web access, pass it a fetch tool:

```typescript
import { generateText, tool, jsonSchema } from "ai";

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
- This is the **only** extraction path in Iris — see `aiExtractPrice` in
  `packages/prices/src/pipeline/ai-extract.ts`.

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

### generateText (with a fetch tool — the Iris extraction path)

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
| Rate limit exceeded | Too many requests | Implement exponential backoff |
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
```

There are no per-provider env vars (`OPENAI_API_KEY`, `GOOGLE_*`,
`ANTHROPIC_API_KEY`, `OPENCODE_*` are gone). To use a non-OpenAI model, point
`AI_BASE_URL` at an OpenAI-compatible gateway (OpenRouter, OpenCode Zen, a
local Ollama server, etc.).
