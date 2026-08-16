import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelType } from "@iris/utils";

/**
 * Tests for `summary.ts` — product summary formatter + sender.
 *
 * `sendProductSummary` reads from two tables:
 *   1. `products`  (via `db.select({...}).from(products).where(...).orderBy(...)`)
 *   2. `alertChannels` (via `db.select().from(alertChannels).where(...)`)
 *
 * Each query is awaited sequentially, so the first call to `db.select(...)`
 * resolves to products and the second to channels. We mock `db.select` with
 * a fluent chainable builder and supply separate fixtures per call.
 *
 * `sendTelegramText` is mocked at the module boundary — we never hit the
 * network. `formatRelativeTime` and `formatProductSummaryMessage` are pure
 * functions and need no mocking.
 */
const { mockDbSelect, mockSendTelegramText } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockSendTelegramText: vi.fn(),
}));

vi.mock("@iris/database", () => ({
  db: {
    select: mockDbSelect,
  },
}));

vi.mock("../../packages/prices/src/notifications/telegram", () => ({
  sendTelegramText: mockSendTelegramText,
}));

import { logger } from "@iris/utils";
import {
  formatProductSummaryMessage,
  formatRelativeTime,
  sendProductSummary,
} from "../../packages/prices/src/notifications/summary";

/**
 * Build a fluent Drizzle-style chain mock. `db.select(...).from(...).where(...)`
 * optionally `.orderBy(...)` resolves with the supplied rows.
 *
 * Drizzle's chained query builder is just an object whose methods return
 * `this` (or a thenable). The only async terminals `sendProductSummary` hits
 * are `await db.select({...}).from(products).where(...).orderBy(...)` for
 * products and `await db.select().from(alertChannels).where(...)` for
 * channels — so we make the last chainable method a thenable that resolves
 * with the supplied rows.
 */
function chainable(result: unknown[]) {
  const chain: {
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    then: <T>(
      onFulfilled: (value: unknown[]) => T,
    ) => Promise<Awaited<T>>;
  } = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    then(onFulfilled) {
      return Promise.resolve(result).then(onFulfilled);
    },
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  return chain;
}

/** Program two sequential `db.select(...)` calls: products first, channels second. */
function fakeDbSelect(products: unknown[], channels: unknown[]) {
  const productsChain = chainable(products);
  const channelsChain = chainable(channels);
  mockDbSelect
    .mockReturnValueOnce(productsChain)
    .mockReturnValueOnce(channelsChain);
  return { productsChain, channelsChain };
}

function productRow(overrides: Partial<{
  id: string;
  url: string;
  name: string | null;
  currency: string | null;
  currentPrice: string | null;
  lastCheckedAt: Date | null;
  active: boolean;
}> = {}) {
  return {
    id: "prod-1",
    url: "https://shop.test/widget",
    name: "Widget",
    currency: "USD",
    currentPrice: "99.00",
    lastCheckedAt: new Date(),
    active: true,
    ...overrides,
  };
}

function channelRow(overrides: Partial<{
  id: string;
  userId: string;
  channelType: ChannelType;
  config: unknown;
  enabled: boolean;
}> = {}) {
  return {
    id: "ch-1",
    userId: "user-1",
    channelType: "telegram" as ChannelType,
    config: { chatId: "123456", language: "en" },
    enabled: true,
    ...overrides,
  };
}

describe("formatRelativeTime", () => {
  const now = new Date("2026-08-16T12:00:00Z");
  let nowSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    nowSpy = vi.spyOn(Date, "now").mockReturnValue(now.getTime());
  });

  afterEach(() => {
    nowSpy?.mockRestore();
  });

  it("returns 'never' / '从未' for a null date", () => {
    expect(formatRelativeTime(null, "en")).toBe("never");
    expect(formatRelativeTime(null, "zh")).toBe("从未");
  });

  it("returns 'just now' / '刚刚' for under 60 seconds", () => {
    const date = new Date(now.getTime() - 30 * 1000);
    expect(formatRelativeTime(date, "en")).toBe("just now");
    expect(formatRelativeTime(date, "zh")).toBe("刚刚");
  });

  it("returns '1m ago' / '1分钟前' for exactly 1 minute", () => {
    const date = new Date(now.getTime() - 60 * 1000);
    expect(formatRelativeTime(date, "en")).toBe("1m ago");
    expect(formatRelativeTime(date, "zh")).toBe("1分钟前");
  });

  it("returns '59m ago' / '59分钟前' for 59 minutes", () => {
    const date = new Date(now.getTime() - 59 * 60 * 1000);
    expect(formatRelativeTime(date, "en")).toBe("59m ago");
    expect(formatRelativeTime(date, "zh")).toBe("59分钟前");
  });

  it("returns '1h ago' / '1小时前' for exactly 1 hour", () => {
    const date = new Date(now.getTime() - 60 * 60 * 1000);
    expect(formatRelativeTime(date, "en")).toBe("1h ago");
    expect(formatRelativeTime(date, "zh")).toBe("1小时前");
  });

  it("returns '23h ago' / '23小时前' for 23 hours", () => {
    const date = new Date(now.getTime() - 23 * 60 * 60 * 1000);
    expect(formatRelativeTime(date, "en")).toBe("23h ago");
    expect(formatRelativeTime(date, "zh")).toBe("23小时前");
  });

  it("returns '1d ago' / '1天前' for exactly 1 day", () => {
    const date = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(date, "en")).toBe("1d ago");
    expect(formatRelativeTime(date, "zh")).toBe("1天前");
  });

  it("returns '6d ago' / '6天前' for 6 days", () => {
    const date = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(date, "en")).toBe("6d ago");
    expect(formatRelativeTime(date, "zh")).toBe("6天前");
  });

  it("returns a locale date string for 7+ days (en)", () => {
    const date = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const result = formatRelativeTime(date, "en");
    // Locale string must include digits (e.g. "8/9/2026" or "09/08/2026").
    expect(result).toMatch(/\d/);
    // No relative markers — locale strings never include "ago".
    expect(result).not.toMatch(/ago/);
  });
});

describe("formatProductSummaryMessage", () => {
  const baseItem = {
    url: "https://shop.test/widget",
    name: "Widget",
    currency: "USD",
    currentPrice: 99,
    lastCheckedAt: new Date(),
    active: true,
  };

  it("renders the header + 'No products tracked yet.' for empty items (en)", () => {
    const message = formatProductSummaryMessage([], "en");
    expect(message).toContain("📦 <b>Product summary</b>");
    expect(message).toContain("No products tracked yet.");
  });

  it("renders the Chinese header + '暂无追踪商品' for empty items (zh)", () => {
    const message = formatProductSummaryMessage([], "zh");
    expect(message).toContain("📦 <b>商品摘要</b>");
    expect(message).toContain("暂无追踪商品");
  });

  it("renders the count line and active marker for a single active product", () => {
    const message = formatProductSummaryMessage([baseItem], "en");
    expect(message).toContain("1 tracked · 1 active · 0 paused");
    expect(message).toContain("✅ Active");
    expect(message).toContain("💰 USD 99.00");
  });

  it("renders the paused marker for a single paused product", () => {
    const message = formatProductSummaryMessage(
      [{ ...baseItem, active: false }],
      "en",
    );
    expect(message).toContain("⏸️ Paused");
    expect(message).toContain("0 active · 1 paused");
  });

  it("renders the count line for three mixed products", () => {
    const items = [
      { ...baseItem, id: "1", name: "A", active: true },
      { ...baseItem, id: "2", name: "B", active: true },
      { ...baseItem, id: "3", name: "C", active: false },
    ];
    const message = formatProductSummaryMessage(items, "en");
    expect(message).toContain("3 tracked · 2 active · 1 paused");
  });

  it("renders 'No price recorded' when currentPrice is null", () => {
    const message = formatProductSummaryMessage(
      [{ ...baseItem, currentPrice: null }],
      "en",
    );
    expect(message).toContain("💰 No price recorded");
  });

  it("uses Chinese prose for active/paused + header in zh", () => {
    const message = formatProductSummaryMessage(
      [
        { ...baseItem, id: "1", active: true },
        { ...baseItem, id: "2", name: "Other", active: false },
      ],
      "zh",
    );
    expect(message).toContain("📦 <b>商品摘要</b>");
    expect(message).toContain("✅ 活跃");
    expect(message).toContain("⏸️ 暂停");
  });
});

describe("sendProductSummary", () => {
  beforeEach(() => {
    mockDbSelect.mockReset();
    mockSendTelegramText.mockReset();
    // sendTelegramText's real implementation never rejects (best-effort),
    // and we assert call counts/text below, not returned values — leaving the
    // mock at vi.fn() defaults (returns undefined) is sufficient.
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the 'no products' message when products is empty but channels exist", async () => {
    fakeDbSelect(
      [], // no products
      [
        channelRow({
          id: "ch-1",
          config: { chatId: "123456", language: "en" },
        }),
      ],
    );

    const result = await sendProductSummary("user-1");

    expect(result).toEqual({ sent: 1, total: 1, productsCount: 0 });
    expect(mockSendTelegramText).toHaveBeenCalledTimes(1);
    const [, text] = mockSendTelegramText.mock.calls[0] ?? [];
    expect(text).toContain("📦 <b>Product summary</b>");
    expect(text).toContain("No products tracked yet.");
  });

  it("returns zeros and skips send when no enabled channels exist", async () => {
    fakeDbSelect([productRow()], []);

    const result = await sendProductSummary("user-1");

    expect(result).toEqual({ sent: 0, total: 0, productsCount: 1 });
    expect(mockSendTelegramText).not.toHaveBeenCalled();
  });

  it("sends one message for a single channel and returns sent=1", async () => {
    fakeDbSelect(
      [productRow()],
      [
        channelRow({
          id: "ch-1",
          config: { chatId: "123456", language: "en" },
        }),
      ],
    );

    const result = await sendProductSummary("user-1");

    expect(result).toEqual({ sent: 1, total: 1, productsCount: 1 });
    expect(mockSendTelegramText).toHaveBeenCalledTimes(1);
    expect(mockSendTelegramText).toHaveBeenCalledWith(
      "123456",
      expect.stringContaining("1 tracked · 1 active · 0 paused"),
      { userId: "user-1", productsCount: 1, language: "en" },
    );
  });

  it("groups mixed en/zh channels: ≤2 messages built, shared per language", async () => {
    fakeDbSelect(
      [productRow()],
      [
        channelRow({
          id: "ch-en-1",
          config: { chatId: "111", language: "en" },
        }),
        channelRow({
          id: "ch-en-2",
          config: { chatId: "222", language: "en" },
        }),
        channelRow({
          id: "ch-zh-1",
          config: { chatId: "333", language: "zh" },
        }),
      ],
    );

    const result = await sendProductSummary("user-1");

    // 3 channels total, 3 successful sends (each channel receives its lang's text).
    expect(result).toEqual({ sent: 3, total: 3, productsCount: 1 });
    // Per-language batching → 2 sends per language group + 1 for zh = 3 total
    // (one message body is shared per language, but each channel still calls
    // sendTelegramText).
    expect(mockSendTelegramText).toHaveBeenCalledTimes(3);

    const textsByLang = mockSendTelegramText.mock.calls.reduce<
      Record<string, Set<string>>
    >((acc, call) => {
      const meta = call[2] as { language?: string };
      const lang = meta?.language ?? "en";
      const bucket = acc[lang] ?? new Set<string>();
      bucket.add(call[1] as string);
      acc[lang] = bucket;
      return acc;
    }, {});

    // Each language group must share ONE message text across its channels.
    expect(textsByLang.en?.size).toBe(1);
    expect(textsByLang.zh?.size).toBe(1);
    // English text uses English header, Chinese text uses Chinese header.
    const enText = textsByLang.en?.values().next().value;
    const zhText = textsByLang.zh?.values().next().value;
    expect(enText).toContain("📦 <b>Product summary</b>");
    expect(zhText).toContain("📦 <b>商品摘要</b>");
  });

  it("skips channels missing chatId and excludes them from sent", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    fakeDbSelect(
      [productRow()],
      [
        channelRow({
          id: "ch-bad",
          config: { language: "en" }, // no chatId
        }),
        channelRow({
          id: "ch-good",
          config: { chatId: "123456", language: "en" },
        }),
      ],
    );

    const result = await sendProductSummary("user-1");

    expect(result.sent).toBeLessThan(result.total);
    expect(result.sent).toBe(1);
    expect(result.total).toBe(2);
    expect(mockSendTelegramText).toHaveBeenCalledTimes(1);
    expect(mockSendTelegramText).toHaveBeenCalledWith(
      "123456",
      expect.any(String),
      expect.objectContaining({ userId: "user-1" }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "Telegram channel missing chatId; skipped summary",
      expect.objectContaining({ channelId: "ch-bad" }),
    );
    warnSpy.mockRestore();
  });
});