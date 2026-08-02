# AI SDK Backend Integration Guidelines

## 1. Overview

This document covers backend integration patterns using the Vercel AI SDK (`ai` package) for AI-powered features.

### Supported Providers
- **OpenAI**: GPT-4o, GPT-4o-mini, GPT-4-turbo
- **Google Gemini**: gemini-1.5-pro, gemini-1.5-flash
- **Anthropic**: Claude 3.5 Sonnet, Claude 3 Opus
- **OpenCode Zen** (`opencode`): OpenAI-compatible gateway
  (`https://opencode.ai/zen/v1`), models like `deepseek-v4-flash-free`.
  Built with `@ai-sdk/openai-compatible`.

### Package Dependencies
```bash
pnpm add ai @ai-sdk/openai @ai-sdk/google @ai-sdk/anthropic @ai-sdk/openai-compatible
```

> **CRITICAL version pin**: `@ai-sdk/openai-compatible` must stay on the `0.2.x`
> line (e.g. `^0.2.16`). The `1.x` line pulls in `@ai-sdk/provider` v2 /
> `provider-utils` v3, which is incompatible with the `ai@4.x` installed here
> (LanguageModelV1). Check the pinned `ai` version before bumping any
> `@ai-sdk/*` package.

### Env Contract (additive, all optional)

```bash
# OpenCode Zen — OpenAI-compatible provider "opencode"
OPENCODE_API_KEY=""                          # empty → provider degrades to null
OPENCODE_BASE_URL="https://opencode.ai/zen/v1"  # overridable without rebuild
```

Registry: `AI_PROVIDER_VALUES` in `packages/utils/src/lib/enum-types.ts` is the
single source of truth. Always derive provider enums from it
(`z.enum(AI_PROVIDER_VALUES)`, `pgEnum("ai_provider", AI_PROVIDER_VALUES)`) —
never hardcode a `"openai" | "gemini" | ...` union, or the list drifts.

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
import { generateObject, jsonSchema } from "ai";

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

const { object } = await generateObject<PriceExtraction>({
  model,
  schema: aiSchema(),
  prompt,
});
```

## 1b. Gotcha: DeepSeek thinking models reject `tool_choice`

Zen routes open-source models (e.g. `deepseek-v4-flash-free`) to DeepSeek,
whose **thinking mode** rejects the *required* `tool_choice` that
`generateObject`'s tool mode sends:

```
Error from provider (DeepSeek): Thinking mode does not support this tool_choice
```

Two workarounds exist; which one to use depends on whether the extraction needs
web access (see 1d):

1. **Plain structured output, no tools**: `generateObject` with `mode: "json"`
   (sends `response_format` instead of tool calling):
   ```typescript
   mode: config.provider === "opencode" ? "json" : "auto",
   ```
2. **Structured output + tools**: `generateObject` + `tools` is blocked. Use
   `generateText` with `tools` instead — its default tool_choice is "auto",
   which thinking models accept. Have the model return strict JSON and validate
   it yourself (see 1d).

## 1d. Gotcha: a bare model call has NO web access

A model called through `/chat/completions` (what `createOpenAICompatible` sends)
cannot visit websites — it will honestly report *"I can't visit live
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

- Tool `parameters` must also use the zod-v4-native `toJSONSchema` trick (1a) —
  `tool()` routes parameters through the same broken `zodSchema()` path.
- Parse the strict JSON out of `result.text` and validate with
  `priceExtractionSchema.safeParse` yourself; `generateText` does not validate.
- `generateObject` + `tools` fails on DeepSeek thinking (1b), so the fetch-tool
  path must use `generateText`. Other providers keep `generateObject` (no tools)
  — see `aiExtractPrice` in `packages/prices/src/pipeline/ai-extract.ts`.

## 1c. Gotcha: page truncation can hide the price

`buildExtractionPrompt` truncates HTML to `MAX_PROMPT_HTML_CHARS = 40_000`.
Some sites (e.g. Bunnings NZ) emit megabytes of CSS-in-JS before the actual
price markup, so the truncated prompt contains no price → the model correctly
reports `available: false`. This is a pipeline/prompt characteristic, not an AI
bug — verify a real page's price appears within the truncation window before
assuming extraction failure.

The `opencode` path avoids this entirely: the model fetches the page itself via
the `fetchPage` tool (1d), which returns a compact reduction — visible text
plus any embedded price JSON (React-Query/Next.js pages hydrate
`{"formattedValue":"$119.00","value":119}` into `<script>` blobs).

## 2. Basic Usage

### generateText

Use `generateText` for simple text generation tasks where you need a complete response.

```typescript
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

const { text } = await generateText({
  model: openai("gpt-4o-mini"),
  prompt: "Summarize this document...",
});
```

### generateObject (Structured Output with Zod)

Use `generateObject` when you need type-safe structured output. The AI SDK validates the response against your Zod schema automatically.

```typescript
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const classificationSchema = z.object({
  category: z.enum(["urgent", "normal", "low"]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

const { object } = await generateObject({
  model: openai("gpt-4o-mini"),
  schema: classificationSchema,
  prompt: "Classify the priority of this task...",
});
// object is typed as { category: "urgent" | "normal" | "low", confidence: number, reasoning: string }
```

### streamText (For SSE/Streaming)

Use `streamText` for real-time streaming responses, ideal for chat interfaces and long-form content generation.

```typescript
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const result = streamText({
  model: openai("gpt-4o"),
  messages: conversationHistory,
  system: "You are a helpful assistant.",
});

// Return as SSE stream
return result.toDataStreamResponse();
```

## 3. Telemetry Configuration

**IMPORTANT**: Always enable telemetry for token tracking and performance monitoring.

```typescript
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";

const { object } = await generateObject({
  model: openai("gpt-4o-mini"),
  schema: mySchema,
  prompt,
  experimental_telemetry: {
    isEnabled: true,
    functionId: "orders.classify",  // Module.function naming
    metadata: {
      orderId,
      userId,
    },
  },
});
```

### Telemetry Naming Convention

Use dot-separated format for `functionId`: `module.function`

| Module | Example functionId |
|--------|-------------------|
| Orders | `orders.classify`, `orders.summarize` |
| Support | `support.generateReply`, `support.categorize` |
| Content | `content.summarize`, `content.translate` |
| Users | `users.analyzePreferences` |

### Auto-recorded Metrics

When telemetry is enabled, these metrics are automatically tracked:

| Metric | Description |
|--------|-------------|
| `ai.model.id` | Model identifier (e.g., gpt-4o-mini) |
| `ai.model.provider` | Provider name (e.g., openai) |
| `ai.usage.prompt_tokens` | Input tokens consumed |
| `ai.usage.completion_tokens` | Output tokens generated |
| `ai.usage.total_tokens` | Total tokens used |
| `ai.response.finish_reason` | Completion reason (stop, length, etc.) |

## 4. Tool Calling

Define tools that the AI model can invoke to perform actions in your system.

```typescript
import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const result = await generateText({
  model: openai("gpt-4o"),
  prompt: "Create a task for the user...",
  tools: {
    createTask: tool({
      description: "Create a new task in the system",
      parameters: z.object({
        title: z.string(),
        dueDate: z.string().optional(),
        priority: z.enum(["high", "medium", "low"]),
      }),
      execute: async ({ title, dueDate, priority }) => {
        const task = await db.insert(tasks).values({
          title,
          dueDate: dueDate ? new Date(dueDate) : null,
          priority,
        }).returning();
        return { success: true, taskId: task[0].id };
      },
    }),
    searchOrders: tool({
      description: "Search for orders by criteria",
      parameters: z.object({
        query: z.string(),
        status: z.enum(["pending", "completed", "cancelled"]).optional(),
        limit: z.number().default(10),
      }),
      execute: async ({ query, status, limit }) => {
        const orders = await db.query.orders.findMany({
          where: and(
            like(orders.title, `%${query}%`),
            status ? eq(orders.status, status) : undefined
          ),
          limit,
        });
        return { orders };
      },
    }),
  },
});

// Access tool results
if (result.toolCalls) {
  for (const toolCall of result.toolCalls) {
    console.log(`Tool: ${toolCall.toolName}`, toolCall.result);
  }
}
```

## 5. Error Handling

Always implement graceful error handling for AI operations.

```typescript
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { logger } from "@your-app/logs";

async function classifyOrder(orderData: OrderData) {
  try {
    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: classificationSchema,
      prompt: buildClassificationPrompt(orderData),
      experimental_telemetry: {
        isEnabled: true,
        functionId: "orders.classify",
      },
    });
    return { success: true, data: object };
  } catch (error) {
    logger.error("AI generation failed", {
      error,
      orderId: orderData.id,
      prompt: buildClassificationPrompt(orderData).slice(0, 100)
    });

    // Return graceful fallback
    return {
      success: false,
      reason: "AI processing failed",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
```

### Common Error Types

| Error | Cause | Resolution |
|-------|-------|------------|
| Rate limit exceeded | Too many requests | Implement exponential backoff |
| Context length exceeded | Prompt too long | Truncate or summarize input |
| Invalid API key | Missing/wrong credentials | Check environment variables |
| Schema validation failed | AI output doesn't match schema | Adjust schema or prompt |

## 6. Prompt Engineering Best Practices

### Use XML Structure for Complex Prompts

XML tags help the AI model better understand the structure of your request.

```typescript
const prompt = `
<context>
${contextData}
</context>

<task>
Analyze the above context and extract key information.
</task>

<output_format>
Return a JSON object with the following fields:
- summary: A brief summary
- keyPoints: Array of key points
- sentiment: positive, negative, or neutral
</output_format>
`;
```

### System Prompts

Define consistent behavior with system prompts.

```typescript
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

const result = await generateText({
  model: openai("gpt-4o"),
  system: `You are a professional assistant.
Always respond in a structured format.
Be concise and accurate.
Never make up information - if unsure, say so.`,
  messages: userMessages,
});
```

### Multi-step Prompts

For complex tasks, break down into multiple AI calls.

```typescript
// Step 1: Extract entities
const { object: entities } = await generateObject({
  model: openai("gpt-4o-mini"),
  schema: entitiesSchema,
  prompt: `Extract entities from: ${document}`,
});

// Step 2: Classify based on entities
const { object: classification } = await generateObject({
  model: openai("gpt-4o-mini"),
  schema: classificationSchema,
  prompt: `
<entities>
${JSON.stringify(entities, null, 2)}
</entities>

<task>
Based on these entities, classify the document category.
</task>
`,
});
```

## 7. Provider-Specific Configuration

### OpenAI

```typescript
import { openai } from "@ai-sdk/openai";

const model = openai("gpt-4o-mini", {
  // Optional: custom configuration
});
```

### Google Gemini

```typescript
import { google } from "@ai-sdk/google";

const model = google("gemini-1.5-flash");
```

### Anthropic

```typescript
import { anthropic } from "@ai-sdk/anthropic";

const model = anthropic("claude-3-5-sonnet-20241022");
```

### OpenCode Zen (OpenAI-compatible)

```typescript
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const model = createOpenAICompatible({
  name: "opencode",
  baseURL: getEnv().OPENCODE_BASE_URL,
  apiKey: getEnv().OPENCODE_API_KEY,
})(getEnv().AI_MODEL);
```

Missing key (`OPENCODE_API_KEY === ""`) → `createModel` returns `null` and the
pipeline logs "AI provider not configured" instead of throwing.

## 8. Best Practices Summary

| Rule | Description |
|------|-------------|
| Always enable telemetry | Track token usage and performance for cost monitoring |
| Use generateObject for structured output | Leverage Zod schemas for type safety and validation |
| Use XML prompts for complex tasks | Better structure improves AI understanding |
| Handle errors gracefully | Return fallback responses, never crash |
| Log AI failures | Include context (truncated prompt, IDs) for debugging |
| Use appropriate model sizes | Use mini models for simple tasks, larger for complex |
| Implement rate limiting | Protect against API quota exhaustion |
| Cache responses when appropriate | Reduce costs for repeated queries |

## 9. Environment Variables

Required environment variables for AI providers:

```bash
# OpenAI
OPENAI_API_KEY=sk-...

# Google Gemini
GOOGLE_GENERATIVE_AI_API_KEY=...

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# OpenCode Zen (provider "opencode")
OPENCODE_API_KEY=sk-zen-...
OPENCODE_BASE_URL=https://opencode.ai/zen/v1
```
