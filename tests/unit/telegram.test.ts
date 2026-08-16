import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PriceAlertNotification } from "../../packages/prices/src/notifications/format";

process.env.CAMOUFOX_SIDECAR_URL = "http://127.0.0.1:8000";

const { getGlobalSettings } = vi.hoisted(() => ({ getGlobalSettings: vi.fn() }));

vi.mock("@iris/database/drizzle/queries", () => ({
  getGlobalSettings,
}));

import { logger, resetEnvCache } from "@iris/utils";
import {
  sendTelegramText,
  telegramChannel,
} from "../../packages/prices/src/notifications/telegram";

resetEnvCache();

const TOKEN_DB = "db-token-1234";
const TOKEN_ENV = "env-token-5678";
const TELEGRAM_API_URL = "https://api.telegram.org/bot";

const NOTIFICATION: PriceAlertNotification = {
  productId: "prod-1",
  userId: "user-1",
  productName: "Widget",
  productUrl: "https://shop.test/widget",
  currency: "USD",
  oldPrice: 100,
  newPrice: 90,
  direction: "fall",
};

/**
 * Build a fake `fetch` whose responses are scripted in order. Each entry is
 * either a `Response` to return or an `Error` to throw (used to simulate
 * network/timeout failures). Captures every call so tests can assert URL +
 * body shape.
 */
function fakeFetch(responses: Array<() => Response | Error>) {
  let i = 0;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const spy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses[i++];
    if (!next) {
      throw new Error(`no more fake responses scheduled (call #${i})`);
    }
    const value = next();
    if (value instanceof Error) throw value;
    return value;
  });
  vi.stubGlobal("fetch", spy);
  return { spy, calls };
}

function okResponse(): Response {
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function httpError(status: number, body = "bad"): Response {
  return new Response(body, { status });
}

describe("sendTelegramText token resolution", () => {
  beforeEach(() => {
    getGlobalSettings.mockReset();
    process.env.TELEGRAM_BOT_TOKEN = "";
    resetEnvCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.TELEGRAM_BOT_TOKEN = "";
    resetEnvCache();
  });

  it("uses the bot token from global_settings when present", async () => {
    getGlobalSettings.mockResolvedValue({ telegramBotToken: TOKEN_DB });
    const { calls } = fakeFetch([() => okResponse()]);

    await sendTelegramText("123456", "hello", { trace: 1 });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${TELEGRAM_API_URL}${TOKEN_DB}/sendMessage`);
  });

  it("falls back to TELEGRAM_BOT_TOKEN env var when getGlobalSettings returns null", async () => {
    getGlobalSettings.mockResolvedValue(null);
    process.env.TELEGRAM_BOT_TOKEN = TOKEN_ENV;
    resetEnvCache();
    const { calls } = fakeFetch([() => okResponse()]);

    await sendTelegramText("123456", "hello");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${TELEGRAM_API_URL}${TOKEN_ENV}/sendMessage`);
  });

  it("skips and warns when both DB token and env var are empty", async () => {
    getGlobalSettings.mockResolvedValue({ telegramBotToken: "" });
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { spy } = fakeFetch([]);

    await sendTelegramText("123456", "hello", { trace: 2 });

    expect(spy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "Telegram bot token not configured; skipping message",
      { trace: 2 },
    );
    warnSpy.mockRestore();
  });
});

describe("sendTelegramText chatId validation", () => {
  beforeEach(() => {
    getGlobalSettings.mockReset();
    process.env.TELEGRAM_BOT_TOKEN = TOKEN_DB;
    resetEnvCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.TELEGRAM_BOT_TOKEN = "";
    resetEnvCache();
  });

  it("skips and warns on an empty or whitespace chatId (no fetch)", async () => {
    getGlobalSettings.mockResolvedValue({ telegramBotToken: TOKEN_DB });
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { spy } = fakeFetch([]);

    await sendTelegramText("", "hello");
    await sendTelegramText("   ", "hello");

    expect(spy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "Telegram chatId is empty; skipping message",
      {},
    );
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });
});

describe("sendTelegramText HTTP responses", () => {
  beforeEach(() => {
    getGlobalSettings.mockReset();
    getGlobalSettings.mockResolvedValue({ telegramBotToken: TOKEN_DB });
    process.env.TELEGRAM_BOT_TOKEN = "";
    resetEnvCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.TELEGRAM_BOT_TOKEN = "";
    resetEnvCache();
  });

  it("POSTs to the bot sendMessage URL with parse_mode HTML + disable_web_page_preview on 200", async () => {
    const { calls } = fakeFetch([() => okResponse()]);

    await sendTelegramText("123456", "<b>Hello</b> world & <i>you</i>", {
      source: "test",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${TELEGRAM_API_URL}${TOKEN_DB}/sendMessage`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toEqual({ "Content-Type": "application/json" });
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body).toEqual({
      chat_id: "123456",
      text: "<b>Hello</b> world & <i>you</i>",
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  });

  it("retries as plain text (no parse_mode, stripped tags) when HTML send returns 400", async () => {
    const { calls, spy } = fakeFetch([
      () => httpError(400, "bad markup"),
      () => okResponse(),
    ]);

    await sendTelegramText("123456", "<b>Hello</b> & welcome <i>friend</i>");

    expect(spy).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(calls[0]?.init?.body));
    const secondBody = JSON.parse(String(calls[1]?.init?.body));
    expect(firstBody.parse_mode).toBe("HTML");
    expect(firstBody.text).toContain("<b>Hello</b>");
    // Plain-text retry: no parse_mode + tags stripped.
    expect(secondBody.parse_mode).toBeUndefined();
    expect(secondBody.text).toBe("Hello & welcome friend");
    expect(secondBody.disable_web_page_preview).toBe(true);
    expect(secondBody.chat_id).toBe("123456");
  });

  it("logs error and swallows when the plain-text retry also fails with 400", async () => {
    const { spy } = fakeFetch([
      () => httpError(400, "still bad"),
      () => httpError(400, "still bad"),
    ]);
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await sendTelegramText("123456", "<b>broken</b>");

    expect(spy).toHaveBeenCalledTimes(2);
    // First attempt warns about the HTML rejection, second attempt logs an
    // error when the plain-text retry also fails.
    expect(warnSpy).toHaveBeenCalledWith(
      "Telegram rejected HTML markup; retrying as plain text",
      expect.objectContaining({ chatId: "123456" }),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "Telegram message failed",
      expect.objectContaining({ chatId: "123456" }),
    );
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("logs error and swallows (no retry) on a 5xx response", async () => {
    const { spy } = fakeFetch([() => httpError(502, "upstream")]);
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await sendTelegramText("123456", "hello");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "Telegram message failed",
      expect.objectContaining({ chatId: "123456" }),
    );
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("sendTelegramText timeout", () => {
  beforeEach(() => {
    getGlobalSettings.mockReset();
    getGlobalSettings.mockResolvedValue({ telegramBotToken: TOKEN_DB });
    process.env.TELEGRAM_BOT_TOKEN = "";
    resetEnvCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.TELEGRAM_BOT_TOKEN = "";
    resetEnvCache();
  });

  it("logs error and swallows when fetch rejects with an AbortError (timeout)", async () => {
    const spy = vi.fn(async () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    });
    vi.stubGlobal("fetch", spy);
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    // Must not throw to the caller.
    await expect(sendTelegramText("123456", "hello")).resolves.toBeUndefined();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "Telegram message failed",
      expect.objectContaining({ chatId: "123456" }),
    );
    errorSpy.mockRestore();
  });
});

describe("sendTelegramText concurrency", () => {
  beforeEach(() => {
    getGlobalSettings.mockReset();
    getGlobalSettings.mockResolvedValue({ telegramBotToken: TOKEN_DB });
    process.env.TELEGRAM_BOT_TOKEN = "";
    resetEnvCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.TELEGRAM_BOT_TOKEN = "";
    resetEnvCache();
  });

  it("bounds in-flight fetches to TELEGRAM_CONCURRENCY (5) under 10 parallel calls", async () => {
    let inFlight = 0;
    let peak = 0;

    const spy = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // Each fetch holds a slot long enough that 10 concurrent calls have
      // to queue through the p-limit(5) limiter.
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      inFlight -= 1;
      return okResponse();
    });
    vi.stubGlobal("fetch", spy);

    const calls = Array.from({ length: 10 }, (_, i) =>
      sendTelegramText(`chat-${i}`, `msg-${i}`),
    );
    await Promise.all(calls);

    expect(spy).toHaveBeenCalledTimes(10);
    // p-limit is configured with TELEGRAM_CONCURRENCY = 5.
    expect(peak).toBeLessThanOrEqual(5);
    // And actually saturated — if it never went above 1, the test would not
    // be exercising concurrency.
    expect(peak).toBeGreaterThan(1);
  }, 15_000);
});

describe("telegramChannel.send", () => {
  let formatSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    getGlobalSettings.mockReset();
    getGlobalSettings.mockResolvedValue({ telegramBotToken: TOKEN_DB });
    process.env.TELEGRAM_BOT_TOKEN = "";
    resetEnvCache();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env.TELEGRAM_BOT_TOKEN = "";
    resetEnvCache();
    formatSpy = undefined;
  });

  it("delegates to formatPriceAlertMessage with lang='zh' when config.language='zh'", async () => {
    const { spy } = fakeFetch([() => okResponse()]);

    // Spy on the formatter via module-level patch so we can verify the lang
    // arg without coupling to the message body shape.
    const formatModule = await import(
      "../../packages/prices/src/notifications/format"
    );
    formatSpy = vi
      .spyOn(formatModule, "formatPriceAlertMessage")
      .mockReturnValue("<b>mocked</b>");

    await telegramChannel.send(NOTIFICATION, { chatId: "123456", language: "zh" });

    expect(formatSpy).toHaveBeenCalledTimes(1);
    expect(formatSpy).toHaveBeenCalledWith(NOTIFICATION, "zh");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("warns and skips when config has no chatId", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { spy } = fakeFetch([]);

    await telegramChannel.send(NOTIFICATION, { language: "en" });
    await telegramChannel.send(NOTIFICATION, { chatId: "  ", language: "en" });

    expect(spy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "Telegram channel config missing chatId; skipping alert",
      { productId: NOTIFICATION.productId },
    );
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  it("falls back to lang='en' when config.language is missing or invalid", async () => {
    const { spy } = fakeFetch([
      () => okResponse(),
      () => okResponse(),
    ]);

    const formatModule = await import(
      "../../packages/prices/src/notifications/format"
    );
    formatSpy = vi
      .spyOn(formatModule, "formatPriceAlertMessage")
      .mockReturnValue("<b>mocked</b>");

    await telegramChannel.send(NOTIFICATION, { chatId: "123456" });
    await telegramChannel.send(NOTIFICATION, { chatId: "654321", language: "fr" });
    await telegramChannel.send(NOTIFICATION, { chatId: "999", language: 42 });

    expect(formatSpy).toHaveBeenCalledTimes(3);
    expect(formatSpy).toHaveBeenNthCalledWith(1, NOTIFICATION, "en");
    expect(formatSpy).toHaveBeenNthCalledWith(2, NOTIFICATION, "en");
    expect(formatSpy).toHaveBeenNthCalledWith(3, NOTIFICATION, "en");
    expect(spy).toHaveBeenCalledTimes(3);
  });
});