import { generateText, jsonSchema, tool } from "ai";
import type { LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getEnv, logger } from "@iris/utils";
import type { AiModelOverride } from "@iris/utils";
import type { GlobalSettingsRow } from "@iris/database/drizzle/queries";
import { z } from "zod";
import { priceExtractionSchema, type PriceExtraction } from "./types";
import { fetchPage } from "./fetch-page";

/**
 * AI price extraction via `generateText` + a `fetchPage` tool
 * (ai-sdk-integration.md §1b/1d).
 *
 * The AI config is generic OpenAI-compatible: base URL + API key + model, all
 * stored in `global_settings` (admin-editable). The pipeline resolves config as
 * DB → env fallback (R6). The API key is the only secret; when it is empty in
 * both the DB and the environment, extraction degrades to a logged no-op
 * instead of throwing.
 */

export interface ResolvedAiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Resolve the AI config for a check. Returns null when neither global settings
 * nor env fallbacks provide a base URL / model. An empty API key is allowed
 * here — `createModel` handles the degrade-to-null case so the behavior matches
 * the "missing key → logged no-op" design.
 */
export function resolveAiConfig(
  globalSettings: Pick<GlobalSettingsRow, "aiBaseUrl" | "aiApiKey" | "aiModel"> | null,
  override: AiModelOverride | null = null,
): ResolvedAiConfig | null {
  const env = getEnv();
  const baseUrl = globalSettings?.aiBaseUrl || env.AI_BASE_URL;
  const apiKey = globalSettings?.aiApiKey || env.AI_API_KEY;
  const model = override?.model ?? globalSettings?.aiModel ?? env.AI_MODEL;

  if (!baseUrl || !model) {
    return null;
  }

  return { baseUrl, apiKey, model };
}

/**
 * Build a language model for the resolved config. Returns null when the API
 * key is not configured (empty in both DB and env) — the extraction then
 * degrades to a logged no-op instead of throwing.
 */
function createModel(config: ResolvedAiConfig): LanguageModel | null {
  if (config.apiKey === "") {
    return null;
  }
  return createOpenAICompatible({
    name: "iris",
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  })(config.model);
}

/**
 * Reduce a raw product page to the pieces most likely to carry a price, so the
 * fetch tool result stays small enough for the model context: the visible text
 * plus any embedded JSON blobs that client-side-rendered shops (React/Next.js
 * etc.) hydrate prices into. This is what makes pages whose price is not in the
 * server HTML readable at all, and avoids the truncation gotcha (§1c).
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
 * Build the `fetchPage` tool. The tool reuses the pipeline's own page fetcher
 * (retries, backoff, concurrency limiter) and returns a compact reduction of
 * the page so the model can read the price itself — mirroring the web-fetch
 * capability the model has in the OpenCode TUI, which a bare
 * `/chat/completions` call lacks (§1d).
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
price is visible anywhere in the page content, set "available" to false and
use null for the fields you could not determine.

Return ONLY a single JSON object — no prose, no markdown — exactly matching
one of these shapes:
{"price": 119, "currency": "NZD", "name": "Product name", "available": true}
{"price": null, "currency": null, "name": null, "available": false}
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
 * `generateText` (default `tool_choice` "auto") works with thinking models
 * that reject the required `tool_choice` `generateObject` would set (§1b), and
 * lets the model fetch the product page itself and return strict JSON, which we
 * validate with `priceExtractionSchema`.
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

export interface AiExtractOptions {
  url: string;
  productId?: string;
  config: ResolvedAiConfig;
}

/**
 * Extract a price reading from a product page. Never throws: every failure
 * (missing key, AI error, schema mismatch) is logged and `null` is returned so
 * the pipeline records a failed check instead of crashing.
 */
export async function aiExtractPrice(options: AiExtractOptions): Promise<PriceExtraction | null> {
  const { url, productId, config } = options;

  const model = createModel(config);
  if (!model) {
    logger.warn("AI provider not configured (missing API key)", {
      productId,
      url,
    });
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
