import { generateObject, generateText, jsonSchema, tool } from "ai";
import type { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getEnv, logger } from "@iris/utils";
import type { AiModelOverride, AiProvider } from "@iris/utils";
import type { GlobalSettingsRow } from "@iris/database/drizzle/queries";
import { z } from "zod";
import { priceExtractionSchema, type PriceExtraction } from "./types";
import { fetchPage } from "./fetch-page";

/**
 * AI price extraction via `generateObject` + Zod (ai-sdk-integration.md).
 *
 * Provider resolution follows R6: global default (`global_settings` row, falling
 * back to env) → per-user override (reserved for later; schema-ready). API keys
 * always come from the environment, never from the database.
 */

export interface ResolvedAiConfig {
  provider: AiProvider;
  model: string;
}

/**
 * Resolve the AI config for a check. Returns null when neither global settings
 * nor env fallbacks provide a provider/model.
 */
export function resolveAiConfig(
  globalSettings: Pick<GlobalSettingsRow, "aiProvider" | "aiModel"> | null,
  override: AiModelOverride | null = null,
): ResolvedAiConfig | null {
  const provider = override?.provider ?? globalSettings?.aiProvider ?? getEnv().AI_PROVIDER;
  const model = override?.model ?? globalSettings?.aiModel ?? getEnv().AI_MODEL;

  if (!provider || !model) {
    return null;
  }

  return { provider, model };
}

/**
 * Build a language model for the resolved config. Returns null when the API key
 * for the selected provider is not configured — the extraction then degrades to
 * a logged no-op instead of throwing.
 */
function createModel(config: ResolvedAiConfig): LanguageModel | null {
  const env = getEnv();

  switch (config.provider) {
    case "openai": {
      if (env.OPENAI_API_KEY === "") {
        return null;
      }
      return createOpenAI({ apiKey: env.OPENAI_API_KEY })(config.model);
    }
    case "gemini": {
      if (env.GOOGLE_GENERATIVE_AI_API_KEY === "") {
        return null;
      }
      return createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })(config.model);
    }
    case "anthropic": {
      if (env.ANTHROPIC_API_KEY === "") {
        return null;
      }
      return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(config.model);
    }
    case "opencode": {
      if (env.OPENCODE_API_KEY === "") {
        return null;
      }
      return createOpenAICompatible({
        name: "opencode",
        baseURL: env.OPENCODE_BASE_URL,
        apiKey: env.OPENCODE_API_KEY,
      })(config.model);
    }
  }

  return null;
}

const MAX_PROMPT_HTML_CHARS = 40_000;

/**
 * Reduce a raw product page to the pieces most likely to carry a price, so the
 * fetch tool result stays small enough for the model context: the visible text
 * plus any embedded JSON blobs that client-side-rendered shops (React/Next.js
 * etc.) hydrate prices into. This is what makes pages whose price is not in the
 * server HTML readable at all.
 */
function reducePageHtml(html: string): string {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1])
    .filter((s): s is string => s !== undefined);
  const blobs = scripts
    .filter((s) => /price|formattedValue|currency|amount|offers/i.test(s))
    .slice(0, 3)
    .map((b) => b.slice(0, 3_000));

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parts = [`VISIBLE TEXT:\n${text.slice(0, 8_000)}`];
  if (blobs.length > 0) {
    parts.push(`EMBEDDED PRICE DATA:\n${blobs.join("\n---\n")}`);
  }
  return parts.join("\n\n");
}

/**
 * Build the `fetchPage` tool for the opencode provider path. The tool reuses
 * the pipeline's own page fetcher (retries, backoff, concurrency limiter) and
 * returns a compact reduction of the page so the model can read the price
 * itself — mirroring the web-fetch capability the model has in the OpenCode
 * TUI, which a bare `/chat/completions` call lacks.
 */
function buildFetchPageTool() {
  const paramsSchema = z.object({ url: z.string().url() });

  return tool({
    description:
      "Fetch a web page and return a compact representation of its content (visible text plus any embedded price data). Use this to read a product page and find its selling price.",
    parameters: jsonSchema<{ url: string }>(
      paramsSchema.toJSONSchema({ target: "draft-07" }) as unknown as Parameters<typeof jsonSchema>[0],
    ),
    execute: async ({ url }) => {
      const page = await fetchPage(url);
      if (!page) {
        return "ERROR: failed to fetch the page.";
      }
      return reducePageHtml(page.html);
    },
  });
}

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

/**
 * Locate and parse the JSON object in a model response that may contain prose
 * or markdown fences around it.
 */
function parseExtractionJson(text: string): PriceExtraction {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model response");
  }

  const parsed = priceExtractionSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
  if (!parsed.success) {
    throw new Error(`Model response failed schema validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Extract a price reading using `generateText` with a `fetchPage` tool.
 *
 * The opencode provider routes to DeepSeek, whose thinking mode rejects
 * `tool_choice` — which `generateObject` sets when tools are present. Using
 * `generateText` (default tool_choice "auto", so it works with thinking models)
 * lets the model fetch the product page itself and return strict JSON, which we
 * then validate with `priceExtractionSchema`.
 */
async function extractWithFetchTool(
  model: LanguageModel,
  url: string,
  productId: string | undefined,
): Promise<PriceExtraction> {
  const result = await generateText({
    model,
    maxSteps: 5,
    tools: {
      fetchPage: buildFetchPageTool(),
    },
    prompt: buildToolExtractionPrompt(url),
    experimental_telemetry: {
      isEnabled: true,
      functionId: "prices.extract",
      metadata: {
        productId: productId ?? "",
        url,
      },
    },
  });

  return parseExtractionJson(result.text);
}

function buildExtractionPrompt(html: string, url: string): string {
  // Truncate oversized pages so the prompt stays well inside the model context.
  const truncatedHtml =
    html.length > MAX_PROMPT_HTML_CHARS ? html.slice(0, MAX_PROMPT_HTML_CHARS) : html;

  return `
<context>
The following is the raw HTML of an online shop product page.

URL: ${url}

${truncatedHtml}
</context>

<task>
Extract the current selling price of the single product on this page, its
currency, and its name. If the page shows the product as out of stock, or no
price is visible anywhere in the HTML, set "available" to false.
</task>

<output_format>
Return a JSON object with:
- price: a positive number, the current price as a decimal without any currency symbol
- currency: ISO 4217 currency code (e.g. USD, EUR, CNY)
- name: the product title, if visible
- available: boolean — false when out of stock or no price is visible
</output_format>
`;
}

export interface AiExtractOptions {
  html: string;
  url: string;
  productId?: string;
  config: ResolvedAiConfig;
}

/**
 * Build the AI SDK `Schema` for structured output from the zod schema.
 *
 * `ai@4.x` is incompatible with zod v4: its `zodSchema()` helper converts via
 * `zod-to-json-schema`, which reads zod v3's `_def.typeName` and therefore
 * produces an empty `{}` schema for every zod v4 schema. Providers that
 * validate tool schemas strictly (e.g. DeepSeek/Zen) then reject the call with
 * "schema must be a JSON Schema of 'type: object'". Converting with zod v4's
 * native `toJSONSchema()` (which emits `type: "object"` correctly) and passing
 * the result through `jsonSchema()` keeps validation via `safeParse`.
 */
function priceExtractionAiSchema() {
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

/**
 * Extract a price reading from a product page. Never throws: every failure
 * (missing key, unknown provider, AI error, schema mismatch) is logged and
 * `null` is returned so the pipeline records a failed check instead of crashing.
 */
export async function aiExtractPrice(options: AiExtractOptions): Promise<PriceExtraction | null> {
  const { html, url, productId, config } = options;

  const model = createModel(config);
  if (!model) {
    logger.warn("AI provider not configured (missing API key)", {
      provider: config.provider,
      productId,
      url,
    });
    return null;
  }

  try {
    // opencode uses the fetchPage tool (generateText) — see 1b/1d in
    // ai-sdk-integration.md. Other providers keep generateObject, which emits
    // a schema-based tool call on its own.
    if (config.provider === "opencode") {
      return await extractWithFetchTool(model, url, productId);
    }

    // Note: the generic is explicit because zod v4's `z.Schema` puts `Input`
    // in a contravariant position, which blocks TS from inferring `OBJECT`
    // from the schema alone (it would fall back to `unknown`).
    const { object } = await generateObject<PriceExtraction>({
      model,
      schema: priceExtractionAiSchema(),
      prompt: buildExtractionPrompt(html, url),
      experimental_telemetry: {
        isEnabled: true,
        functionId: "prices.extract",
        metadata: {
          productId: productId ?? "",
          url,
        },
      },
    });

    return object;
  } catch (error) {
    logger.error("AI price extraction failed", {
      provider: config.provider,
      model: config.model,
      productId,
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
