import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelType } from "@iris/utils";
import type { PriceAlertNotification } from "../../packages/prices/src/notifications/format";

/**
 * Tests for `dispatch.ts`.
 *
 * The dispatch module combines three concerns:
 *   1. A lazy, idempotent registration of the built-in `telegramChannel`
 *      adapter (`registerDefaultChannels`).
 *   2. A read from the `alert_channels` table for enabled rows belonging to
 *      the notification's user.
 *   3. A fan-out via `Promise.allSettled` to each channel's adapter — best
 *      effort, never throws.
 *
 * We mock the database (`@iris/database`) and the channel registry
 * (`./channel`) so the test exercises only dispatch logic. The `telegram`
 * module is not loaded at all (the dispatch module imports it for the
 * `telegramChannel` constant, but we replace `./channel` with a mock registry
 * and mock the `./telegram` import for the lazy registration path).
 */

const { mockDbSelect, mockRegisterChannel, mockGetChannel, mockTelegramChannel } = vi.hoisted(() => {
  // The dispatch module imports `telegramChannel` at module load via
  // `./telegram` and calls `registerChannel(telegramChannel)` inside
  // `registerDefaultChannels`. We mock it so the lazy registration path is
  // observable: every call to `registerChannel` increments a counter we can
  // assert on.
  const sent = vi.fn();
  return {
    mockDbSelect: vi.fn(),
    mockRegisterChannel: vi.fn(),
    mockGetChannel: vi.fn(),
    mockTelegramChannel: { channelType: "telegram" as ChannelType, send: sent },
  };
});

// Expose the inner `send` mock so individual tests can configure rejections
// and assert call counts.
const { mockTelegramSend } = vi.hoisted(() => ({
  mockTelegramSend: (mockTelegramChannel as { send: ReturnType<typeof vi.fn> }).send,
}));

vi.mock("@iris/database", () => ({
  db: {
    select: mockDbSelect,
  },
}));

vi.mock("../../packages/prices/src/notifications/telegram", () => ({
  telegramChannel: mockTelegramChannel,
}));

vi.mock("../../packages/prices/src/notifications/channel", () => ({
  registerChannel: mockRegisterChannel,
  getChannel: mockGetChannel,
}));

import { logger } from "@iris/utils";
import {
  dispatchPriceAlert,
} from "../../packages/prices/src/notifications/dispatch";

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
 * Build a fluent Drizzle-style chain mock. `db.select(...).from(...).where(...)`
 * resolves with the supplied channel rows.
 *
 * Drizzle's chained query builder is just an object whose methods return
 * `this` (or a thenable). The only async terminal the dispatch module hits is
 * `await db.select().from(...).where(...)`, so we make `where()` return a
 * Promise.
 */
function fakeDbSelect(rows: unknown[]) {
  const chain: { from: () => typeof chain; where: () => Promise<unknown[]> } = {
    from: function () {
      return this;
    },
    where: function () {
      return Promise.resolve(rows);
    },
  };
  mockDbSelect.mockReturnValue(chain);
  return chain;
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

describe("registerDefaultChannels", () => {
  beforeEach(() => {
    vi.resetModules();
    mockRegisterChannel.mockReset();
    // Re-import after reset so the module-level `defaultChannelsRegistered`
    // flag starts as `false`. We need to do this because the mock module
    // binding is preserved across resets.
  });

  it("registers telegramChannel exactly once across repeated calls (idempotent)", async () => {
    // Fresh module instance so the cached `defaultChannelsRegistered` flag
    // starts false for this test.
    const dispatch = await import("../../packages/prices/src/notifications/dispatch");
    const { registerDefaultChannels: register } = dispatch;

    register();
    register();
    register();

    expect(mockRegisterChannel).toHaveBeenCalledTimes(1);
    expect(mockRegisterChannel).toHaveBeenCalledWith(mockTelegramChannel);
  });
});

describe("dispatchPriceAlert", () => {
  beforeEach(() => {
    mockDbSelect.mockReset();
    mockGetChannel.mockReset();
    mockTelegramSend.mockReset();
    mockTelegramSend.mockResolvedValue(undefined);
    // Make `getChannel("telegram")` resolve to the mock telegram adapter by
    // default; individual tests can override this.
    mockGetChannel.mockImplementation((type: ChannelType) =>
      type === "telegram" ? mockTelegramChannel : undefined,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns { sent: 0, total: 0 } when the user has no enabled channels", async () => {
    fakeDbSelect([]);

    const result = await dispatchPriceAlert(NOTIFICATION);

    expect(result).toEqual({ sent: 0, total: 0 });
    expect(mockGetChannel).not.toHaveBeenCalled();
    expect(mockTelegramSend).not.toHaveBeenCalled();
  });

  it("calls the matching adapter once for a single enabled channel and reports success", async () => {
    fakeDbSelect([channelRow({ id: "ch-1" })]);

    const result = await dispatchPriceAlert(NOTIFICATION);

    expect(mockGetChannel).toHaveBeenCalledWith("telegram");
    expect(mockTelegramSend).toHaveBeenCalledTimes(1);
    expect(mockTelegramSend).toHaveBeenCalledWith(NOTIFICATION, {
      chatId: "123456",
      language: "en",
    });
    expect(result).toEqual({ sent: 1, total: 1 });
  });

  it("fans out to multiple enabled channels and reports the correct counts", async () => {
    fakeDbSelect([
      channelRow({ id: "ch-1", config: { chatId: "111", language: "en" } }),
      channelRow({ id: "ch-2", config: { chatId: "222", language: "zh" } }),
      channelRow({ id: "ch-3", config: { chatId: "333", language: "en" } }),
    ]);

    const result = await dispatchPriceAlert(NOTIFICATION);

    expect(mockTelegramSend).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ sent: 3, total: 3 });
  });

  it("warns and skips channels whose adapter is not registered (does not throw)", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    // Override the default registry lookup: `email` is not registered.
    mockGetChannel.mockImplementation((type: ChannelType) =>
      type === "telegram" ? mockTelegramChannel : undefined,
    );
    fakeDbSelect([
      channelRow({ id: "ch-tg", channelType: "telegram", config: { chatId: "111" } }),
      channelRow({ id: "ch-email", channelType: "email", config: { address: "x@y" } }),
    ]);

    const result = await dispatchPriceAlert(NOTIFICATION);

    expect(mockTelegramSend).toHaveBeenCalledTimes(1);
    // The unregistered `email` row short-circuits to `Promise.resolve()`
    // inside dispatch.ts (lines 78-79) rather than throwing, so
    // `Promise.allSettled` records it as fulfilled. `total` still includes
    // both rows — the caller learns about the gap via the warning log.
    expect(result).toEqual({ sent: 2, total: 2 });
    expect(warnSpy).toHaveBeenCalledWith(
      "No notification adapter registered for channel type",
      expect.objectContaining({
        channelType: "email",
        userId: NOTIFICATION.userId,
        productId: NOTIFICATION.productId,
      }),
    );
  });

  it("captures adapter.send() rejections via Promise.allSettled and never throws to the caller", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    mockTelegramSend.mockRejectedValueOnce(new Error("send failed"));

    fakeDbSelect([channelRow({ id: "ch-1" })]);

    // Must resolve normally — `dispatchPriceAlert` swallows rejection.
    const result = await dispatchPriceAlert(NOTIFICATION);

    expect(result).toEqual({ sent: 0, total: 1 });
    expect(errorSpy).toHaveBeenCalledWith(
      "Price alert dispatch failed",
      expect.objectContaining({
        userId: NOTIFICATION.userId,
        productId: NOTIFICATION.productId,
        error: "send failed",
      }),
    );
  });
});