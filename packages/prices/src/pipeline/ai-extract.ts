import pLimit from "p-limit";
import { z } from "zod";
import { getEnv, logger } from "@iris/utils";
import type { AiModelOverride } from "@iris/utils";
import type { GlobalSettingsRow } from "@iris/database/drizzle/queries";
import {
  generateText,
  jsonSchema,
  tool,
  createOpenAICompatible,
  type LanguageModel,
} from "./ai-sdk";
import { priceExtractionSchema, type PriceExtraction } from "./types";
import { fetchPage } from "./fetch-page";

/**
 * AI price extraction via `generateText` (ai-sdk-integration.md §1b/1d/1e).
 *
 * The AI config is generic OpenAI-compatible: base URL + API key + model, all
 * stored in `global_settings` (admin-editable). The pipeline resolves config as
 * DB → env fallback (R6). The API key is the only secret; when it is empty in
 * both the DB and the environment, extraction degrades to a logged no-op
 * instead of throwing.
 *
 * Preferred path (used by `checkPrice`): the page HTML is already fetched by
 * the Camoufox sidecar and passed in. Extraction is a **single** `generateText`
 * call with the reduced page content in the prompt — no tools, no multi-step
 * loop. That avoids a known DeepSeek thinking-mode failure where multi-step
 * tool rounds drop `reasoning_content` on the way back to the API
 * (`@ai-sdk/openai-compatible@0.2.x` does not re-encode reasoning parts;
 * DeepSeek then returns 400 — see §1e).
 *
 * Fallback path: when no HTML is provided, the model may call a `fetchPage`
 * tool (`maxSteps > 1`). Prefer the preloaded path for production checks.
 */

export interface ResolvedAiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  aiZenHost: string;
  aiUserAgent: string;
  aiClientHeader: string;
}

/**
 * Resolve the AI config for a check. Returns null when neither global settings
 * nor env fallbacks provide a base URL / model. An empty API key is allowed
 * here — `createModel` handles the degrade-to-null case so the behavior matches
 * the "missing key → logged no-op" design.
 */
export function resolveAiConfig(
  globalSettings:
    | Pick<
        GlobalSettingsRow,
        "aiBaseUrl" | "aiApiKey" | "aiModel" | "aiZenHost" | "aiUserAgent" | "aiClientHeader"
      >
    | null,
  override: AiModelOverride | null = null,
): ResolvedAiConfig | null {
  const env = getEnv();
  const baseUrl = globalSettings?.aiBaseUrl || env.AI_BASE_URL;
  const apiKey = globalSettings?.aiApiKey || env.AI_API_KEY;
  const model = override?.model ?? globalSettings?.aiModel ?? env.AI_MODEL;
  const aiZenHost = globalSettings?.aiZenHost || env.AI_ZEN_HOST;
  const aiUserAgent = globalSettings?.aiUserAgent || env.AI_USER_AGENT;
  const aiClientHeader = globalSettings?.aiClientHeader || env.AI_CLIENT_HEADER;

  if (!baseUrl || !model) {
    return null;
  }

  return { baseUrl, apiKey, model, aiZenHost, aiUserAgent, aiClientHeader };
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
  const isZenEndpoint =
    config.aiZenHost !== "" && new URL(config.baseUrl).hostname === config.aiZenHost;
  const headers: Record<string, string> = {};
  if (isZenEndpoint) {
    if (config.aiUserAgent !== "") {
      headers["User-Agent"] = config.aiUserAgent;
    }
    if (config.aiClientHeader !== "") {
      headers["X-Opencode-Client"] = config.aiClientHeader;
    }
  }
  return createOpenAICompatible({
    name: "iris",
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  })(config.model);
}

/**
 * Reduce a raw product page to the pieces most likely to carry a price, so the
 * model context stays small: the visible text plus any embedded JSON blobs that
 * client-side-rendered shops (React/Next.js etc.) hydrate prices into. This is
 * what makes pages whose price is not in the server HTML readable at all, and
 * avoids the truncation gotcha (§1c).
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
 * Build the `fetchPage` tool (fallback path only). The tool reuses the
 * pipeline's own page fetcher and returns a compact reduction of the page.
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
        // Transport failed after retries (sidecar down, network error). The
        // model sees an explicit error string so it does not hallucinate a
        // price from missing content.
        return "ERROR: failed to fetch the page.";
      }
      if (page.kind === "blocked") {
        // Anti-bot challenge / deny page: no real content to extract from.
        // Surface the signature so the model does not invent a price.
        return `BLOCKED: ${page.signature}`;
      }
      return reducePageHtml(page.html);
    },
  });
}

function buildPageContentExtractionPrompt(url: string, pageContent: string): string {
  return `
Product URL: ${url}

The product page has already been fetched. Below is a compact representation of
its content (visible text plus any embedded price data).

Extract the current selling price of the single product on this page, its
currency, and its name. If the page shows the product as out of stock, or no
price is visible anywhere in the page content, set "available" to false and
use null for the fields you could not determine.

Return ONLY a single JSON object — no prose, no markdown — exactly matching
one of these shapes:
{"price": 119, "currency": "NZD", "name": "Product name", "available": true}
{"price": null, "currency": null, "name": null, "available": false}

PAGE CONTENT:
${pageContent}
`;
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

const AI_EXTRACT_MAX_RETRIES = 3;

/**
 * Limiter + min-interval gap for Zen `generateText`.
 *
 * Concurrency is read from `getEnv()` but captured once on first use (the
 * limiter is memoized), so it is effectively boot-time configuration — an
 * operator changing `AI_EXTRACT_CONCURRENCY` without a restart has no effect.
 * The min-interval gap, by contrast, is read on every call, so
 * `AI_EXTRACT_MIN_INTERVAL_MS` is live-tunable.
 */
let aiExtractLimiter: ReturnType<typeof pLimit> | null = null;

function getAiExtractLimiter(): ReturnType<typeof pLimit> {
  if (aiExtractLimiter === null) {
    aiExtractLimiter = pLimit(getEnv().AI_EXTRACT_CONCURRENCY);
  }
  return aiExtractLimiter;
}

let lastZenCallEndedAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Whether a `generateText` failure should be retried with backoff.
 *
 * Covers two classes of transient upstream failures from the Zen /
 * OpenAI-compatible endpoint:
 *
 * - 429 / "rate limit": the free-tier quota burst. The original retry case.
 * - 502 / 503 / 504: gateway-class transient errors. Zen's DeepSeek free
 *   tier intermittently returns 503 "Service Unavailable" under load even
 *   when the same request succeeds a moment later (confirmed live
 *   2026-08-19: a Kogan extraction that 503'd on the scheduler tick
 *   returned 200 with a correct price when replayed manually). Treating
 *   503 as terminal rolls back product creates for transient outages, so
 *   it must retry here.
 *
 * The AI SDK throws `APICallError` which carries `statusCode` (the HTTP
 * status) and an SDK-computed `isRetryable` flag; we honor both. Plain
 * `Error`s from the transport (network timeouts etc.) are matched by message
 * as a fallback.
 */
function isRetryableError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const candidate = error as {
      status?: unknown;
      code?: unknown;
      statusCode?: unknown;
      isRetryable?: unknown;
      message?: unknown;
    };
    if (
      candidate.status === 429 ||
      candidate.code === 429 ||
      candidate.statusCode === 429 ||
      candidate.status === 502 ||
      candidate.status === 503 ||
      candidate.status === 504 ||
      candidate.statusCode === 502 ||
      candidate.statusCode === 503 ||
      candidate.statusCode === 504
    ) {
      return true;
    }
    if (candidate.isRetryable === true) {
      return true;
    }
    if (typeof candidate.message === "string") {
      if (/rate limit/i.test(candidate.message)) {
        return true;
      }
      if (/\b(502|503|504)\b|service unavailable|bad gateway|gateway timeout/i.test(candidate.message)) {
        return true;
      }
    }
  }
  if (/rate limit/i.test(String(error))) {
    return true;
  }
  return /\b(502|503|504)\b|service unavailable|bad gateway|gateway timeout/i.test(String(error));
}

function calculateRateLimitDelay(attempt: number): number {
  return 2 ** attempt * 1000 + Math.random() * 1000;
}

async function waitForMinInterval(): Promise<void> {
  const elapsed = Date.now() - lastZenCallEndedAt;
  const remaining = getEnv().AI_EXTRACT_MIN_INTERVAL_MS - elapsed;
  if (remaining > 0) {
    await sleep(remaining);
  }
}

/**
 * Reset the module-level throttle state. For tests only: clears the memoized
 * limiter (so a new concurrency value takes effect) and the min-interval
 * clock. Production never calls this.
 *
 * @internal
 */
export function __resetAiExtractThrottle(): void {
  aiExtractLimiter = null;
  lastZenCallEndedAt = 0;
}

async function withAiLimit<T>(
  fn: () => Promise<T>,
  context: { productId?: string; url: string },
): Promise<T> {
  return getAiExtractLimiter()(() => runWithMinIntervalAndRetry(fn, context));
}

/**
 * Every Zen `generateText` goes through the shared limiter. `maxRetries: 0`
 * disables the AI SDK's default 2 immediate retries — those would burst the
 * free-tier quota before our 429 backoff can run.
 */
async function generateTextThrottled(
  options: Parameters<typeof generateText>[0],
  context: { productId?: string; url: string },
) {
  return withAiLimit(() => generateText({ ...options, maxRetries: 0 }), context);
}

async function runWithMinIntervalAndRetry<T>(
  fn: () => Promise<T>,
  context: { productId?: string; url: string },
): Promise<T> {
  for (let attempt = 1; attempt <= AI_EXTRACT_MAX_RETRIES; attempt++) {
    await waitForMinInterval();
    try {
      const result = await fn();
      lastZenCallEndedAt = Date.now();
      return result;
    } catch (error) {
      lastZenCallEndedAt = Date.now();
      if (isRetryableError(error) && attempt < AI_EXTRACT_MAX_RETRIES) {
        const delay = calculateRateLimitDelay(attempt);
        logger.warn("Transient AI provider error, retrying", {
          operation: "aiExtractPrice",
          productId: context.productId,
          url: context.url,
          attempt,
          delay: Math.round(delay),
          error: error instanceof Error ? error.message : String(error),
        });
        await sleep(delay);
        continue;
      }
      // Terminal attempt, or a non-rate-limit error: surface it. The loop has
      // no fall-through path — every iteration returns or throws — so there is
      // no need for a trailing `throw new Error("Failed after N attempts")`.
      throw error;
    }
  }
  // Unreachable: the loop body always returns or throws. Kept for exhaustiveness.
  throw new Error(`Failed after ${AI_EXTRACT_MAX_RETRIES} attempts`);
}

/**
 * Preferred extraction path: page HTML is already in hand (from `fetchPage` /
 * the Camoufox sidecar). Single `generateText` call, no tools — avoids the
 * multi-step `reasoning_content` round-trip failure on DeepSeek thinking
 * models (§1e) and skips a redundant second fetch.
 */
async function extractFromPageContent(
  model: LanguageModel,
  url: string,
  html: string,
  productId: string | undefined,
): Promise<PriceExtraction> {
  const pageContent = reducePageHtml(html);
  const result = await generateTextThrottled(
    {
      model,
      prompt: buildPageContentExtractionPrompt(url, pageContent),
      experimental_telemetry: {
        isEnabled: true,
        functionId: "prices.extract",
        metadata: {
          productId: productId ?? "",
          url,
          path: "preloaded-html",
        },
      },
    },
    { productId, url },
  );

  return parseExtractionJson(result.text);
}

/**
 * Fallback: `generateText` with a `fetchPage` tool (`maxSteps > 1`).
 *
 * Works for non-thinking models. Thinking models (DeepSeek via Zen, etc.) can
 * fail on the second step because `@ai-sdk/openai-compatible@0.2.x` drops
 * `reasoning_content` when re-encoding assistant messages (§1e). Prefer
 * `extractFromPageContent` whenever HTML is already available.
 */
async function extractWithFetchTool(
  model: LanguageModel,
  url: string,
  productId: string | undefined,
): Promise<PriceExtraction> {
  const result = await generateTextThrottled(
    {
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
          path: "fetch-tool",
        },
      },
    },
    { productId, url },
  );

  return parseExtractionJson(result.text);
}

export interface AiExtractOptions {
  url: string;
  productId?: string;
  config: ResolvedAiConfig;
  /**
   * Pre-fetched product-page HTML from `fetchPage`. When provided, extraction
   * uses a single no-tool `generateText` call (preferred). When omitted, the
   * model is given a `fetchPage` tool and may multi-step.
   */
  html?: string;
}

/**
 * Extract a price reading from a product page. Never throws: every failure
 * (missing key, AI error, schema mismatch) is logged and `null` is returned so
 * the pipeline records a failed check instead of crashing.
 */
export async function aiExtractPrice(options: AiExtractOptions): Promise<PriceExtraction | null> {
  const { url, productId, config, html } = options;

  const model = createModel(config);
  if (!model) {
    logger.warn("AI provider not configured (missing API key)", {
      productId,
      url,
    });
    return null;
  }

  try {
    if (html !== undefined) {
      return await extractFromPageContent(model, url, html, productId);
    }
    return await extractWithFetchTool(model, url, productId);
  } catch (error) {
    logger.error("AI price extraction failed", {
      model: config.model,
      productId,
      url,
      path: html !== undefined ? "preloaded-html" : "fetch-tool",
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
