import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.CAMOUFOX_SIDECAR_URL = "http://127.0.0.1:8000";
process.env.AI_EXTRACT_CONCURRENCY = "1";
process.env.AI_EXTRACT_MIN_INTERVAL_MS = "30";

const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));

vi.mock("../../packages/prices/src/pipeline/ai-sdk", () => ({
  generateText,
  jsonSchema: (schema: unknown) => schema,
  tool: (def: unknown) => def,
  createOpenAICompatible: () => () => ({ provider: "mock", modelId: "mock" }),
}));

import { logger, resetEnvCache } from "@iris/utils";
import {
  aiExtractPrice,
  __resetAiExtractThrottle,
  type ResolvedAiConfig,
} from "../../packages/prices/src/pipeline/ai-extract";

resetEnvCache();
__resetAiExtractThrottle();

const CONFIG: ResolvedAiConfig = {
  baseUrl: "https://opencode.ai/zen/v1",
  apiKey: "test-key",
  model: "deepseek-v4-flash-free",
};

const PAGE_HTML = "<html><body><h1>Widget</h1><span>$119.00</span></body></html>";
const OK_TEXT = '{"price":119,"currency":"NZD","name":"Widget","available":true}';

function extract(url: string) {
  return aiExtractPrice({
    url,
    productId: "prod-1",
    config: CONFIG,
    html: PAGE_HTML,
  });
}

describe("aiExtractPrice throttle", () => {
  beforeEach(() => {
    generateText.mockReset();
    // Reset the min-interval clock between tests so a prior test's last Zen
    // call timestamp does not add a spurious wait to the next test's first call.
    __resetAiExtractThrottle();
  });

  it("serializes overlapping generateText calls and waits the min interval", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const startedAt: number[] = [];

    // Each call takes 40ms. With concurrency=1 the limiter alone enforces
    // ~40ms between starts; the min-interval gap (30ms) is shorter than the
    // call duration here, so this test asserts serialization + at least the
    // call duration elapsed. The min-interval gap is exercised directly below.
    generateText.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      startedAt.push(Date.now());
      await new Promise((resolve) => {
        setTimeout(resolve, 40);
      });
      inFlight -= 1;
      return { text: OK_TEXT };
    });

    const [first, second] = await Promise.all([
      extract("https://example.test/a"),
      extract("https://example.test/b"),
    ]);

    expect(first?.available).toBe(true);
    expect(second?.available).toBe(true);
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 0 }),
    );
    // Never more than one in-flight Zen request.
    expect(maxInFlight).toBe(1);
    expect(startedAt).toHaveLength(2);
    expect((startedAt[1] ?? 0) - (startedAt[0] ?? 0)).toBeGreaterThanOrEqual(60);
  });

  it("enforces the min-interval gap between back-to-back calls", async () => {
    // Fast mock (no latency) so the gap, not call duration, is what separates
    // the two starts. With MIN_INTERVAL_MS=30 and instant calls, the second
    // call must wait ~30ms after the first returns before starting.
    generateText.mockImplementation(async () => {
      return { text: OK_TEXT };
    });

    await extract("https://example.test/first");
    const secondStart = Date.now();
    await extract("https://example.test/second");
    const gap = Date.now() - secondStart;

    // The second call's generateText should be delayed by ~MIN_INTERVAL_MS.
    expect(gap).toBeGreaterThanOrEqual(30);
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("retries a first-call 429 and then succeeds", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const rateLimited = Object.assign(new Error("Error from provider (Console): Rate limit exceeded"), {
      status: 429,
    });

    generateText
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValueOnce({ text: OK_TEXT });

    const result = await extract("https://example.test/retry");

    expect(result).toEqual({
      available: true,
      price: 119,
      currency: "NZD",
      name: "Widget",
    });
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      "Rate limited, retrying",
      expect.objectContaining({
        operation: "aiExtractPrice",
        productId: "prod-1",
        url: "https://example.test/retry",
        attempt: 1,
        delay: expect.any(Number),
      }),
    );
    const retryContext = warn.mock.calls[0]?.[1] as { delay?: number } | undefined;
    expect(retryContext?.delay).toBeGreaterThanOrEqual(2000);
    expect(retryContext?.delay).toBeLessThan(3000);
    warn.mockRestore();
  }, 8_000);
});
