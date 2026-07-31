import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { getEnv, logger } from "@iris/utils";
import type { AiModelOverride, AiProvider } from "@iris/utils";
import type { GlobalSettingsRow } from "@iris/database/drizzle/queries";
import { priceExtractionSchema, type PriceExtraction } from "./types";

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
  }

  return null;
}

const MAX_PROMPT_HTML_CHARS = 40_000;

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
    // Note: the generic is explicit because zod v4's `z.Schema` puts `Input`
    // in a contravariant position, which blocks TS from inferring `OBJECT`
    // from the schema alone (it would fall back to `unknown`).
    const { object } = await generateObject<PriceExtraction>({
      model,
      schema: priceExtractionSchema,
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
