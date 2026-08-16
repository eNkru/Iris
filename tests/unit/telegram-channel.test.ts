import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelType } from "@iris/utils";

/**
 * The channel registry is a module-level `Map<ChannelType, NotificationChannel>`.
 * Tests must each see a fresh, empty registry — otherwise state leaks between
 * `it` blocks (and from prior test files). We achieve isolation by calling
 * `vi.resetModules()` in `beforeEach` and dynamically importing the source
 * module so each test gets its own module instance.
 */
async function loadChannelModule() {
  return import("../../packages/prices/src/notifications/channel");
}

function makeMockChannel(channelType: ChannelType) {
  return {
    channelType,
    send: vi.fn().mockResolvedValue(undefined),
  };
}

describe("channel registry", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("registers a channel and retrieves it via getChannel", async () => {
    const { registerChannel, getChannel } = await loadChannelModule();

    const adapter = makeMockChannel("telegram");
    registerChannel(adapter);

    const retrieved = getChannel("telegram");
    expect(retrieved).toBe(adapter);
    expect(retrieved?.channelType).toBe("telegram");
    expect(retrieved?.send).toBe(adapter.send);
  });

  it("returns undefined for a channel type that has not been registered", async () => {
    const { getChannel } = await loadChannelModule();

    // Both enum values are unregistered in this freshly-loaded module instance.
    expect(getChannel("telegram")).toBeUndefined();
    expect(getChannel("email")).toBeUndefined();
  });

  it("replaces the previous adapter when the same channel type is registered twice (last wins)", async () => {
    const { registerChannel, getChannel } = await loadChannelModule();

    const first = makeMockChannel("telegram");
    const second = makeMockChannel("telegram");

    registerChannel(first);
    expect(getChannel("telegram")).toBe(first);

    registerChannel(second);
    expect(getChannel("telegram")).toBe(second);
    expect(getChannel("telegram")).not.toBe(first);
  });
});