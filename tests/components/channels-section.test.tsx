import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

/**
 * Tests for the alert-channel management UI (R11/R12).
 *
 * The component talks to the backend exclusively through four React Query
 * hooks (`useChannels`, `useCreateChannel`, `useUpdateChannel`,
 * `useDeleteChannel`). We mock those hooks so this test stays a pure
 * UI/integration test — no fetches, no QueryClient cache effects, no real
 * mutations. The i18n hook is also mocked so the assertions can match
 * deterministic English strings.
 */

const {
  mockUseChannels,
  mockUseCreateChannel,
  mockUseUpdateChannel,
  mockUseDeleteChannel,
} = vi.hoisted(() => ({
  mockUseChannels: vi.fn(),
  mockUseCreateChannel: vi.fn(),
  mockUseUpdateChannel: vi.fn(),
  mockUseDeleteChannel: vi.fn(),
}));

vi.mock("../../apps/web/src/hooks/use-channels", () => ({
  useChannels: mockUseChannels,
  useCreateChannel: mockUseCreateChannel,
  useUpdateChannel: mockUseUpdateChannel,
  useDeleteChannel: mockUseDeleteChannel,
}));

vi.mock("../../apps/web/src/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      const translations: Record<string, string> = {
        "channels.loading": "Loading...",
        "channels.loadError": "Failed to load",
        "channels.empty": "No channels yet",
        "channels.chatIdLabel": "Chat ID",
        "channels.chatIdPlaceholder": "123456789",
        "channels.chatIdHint": "Telegram chat ID",
        "channels.chatIdInvalid": "Chat ID must be numeric",
        "channels.languageLabel": "Language",
        "channels.addError": "Failed to add",
        "channels.deleteError": "Failed to delete",
        "channels.add": "Add",
        "channels.adding": "Adding...",
        "channels.delete": "Delete",
        "channels.deleting": "Deleting...",
        "channels.enable": "Enable",
        "channels.disable": "Disable",
        "channels.enabled": "Enabled",
        "channels.disabled": "Disabled",
        "channels.rowTitle": "Channel {id}",
      };
      const template = translations[key] ?? key;
      if (!vars) {
        return template;
      }
      return template.replace(/\{(\w+)\}/g, (_, name) => {
        const value = vars[name];
        return value === undefined ? `{${name}}` : String(value);
      });
    },
    lang: "en",
    setLang: () => {},
    mounted: true,
  }),
}));

const { ChannelsSection } = await import(
  "../../apps/web/src/components/channels-section"
);

const sampleChannel = {
  id: "ch-1",
  userId: "user-1",
  channelType: "telegram",
  config: { chatId: "123456789", language: "en" },
  enabled: true,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ChannelsSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setHookDefaults() {
  mockUseChannels.mockReturnValue({
    data: { channels: [] },
    isLoading: false,
    isError: false,
    error: null,
  });
  mockUseCreateChannel.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ success: true }),
    isPending: false,
  });
  mockUseUpdateChannel.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  mockUseDeleteChannel.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  });
}

describe("ChannelsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setHookDefaults();
  });

  it("shows loading spinner when useChannels returns isLoading", () => {
    mockUseChannels.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    });

    const { container } = renderSection();

    // Spinner renders an `aria-hidden` element plus a label span. The label
    // proves the i18n key resolves; the class proves the Spinner primitive
    // is the one used.
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows error box when useChannels returns isError", () => {
    mockUseChannels.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("network down"),
    });

    renderSection();

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("network down");
  });

  it("shows empty state message when no channels", () => {
    mockUseChannels.mockReturnValue({
      data: { channels: [] },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderSection();

    expect(screen.getByText("No channels yet")).toBeInTheDocument();
  });

  it("renders channel list with chatId, enabled label, language selector, enable/disable + delete buttons", () => {
    mockUseChannels.mockReturnValue({
      data: { channels: [sampleChannel] },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderSection();

    // Chat id is interpolated into the row title via `t("channels.rowTitle", { id })`.
    expect(screen.getByText("Channel 123456789")).toBeInTheDocument();

    // Status label reflects the channel's `enabled` flag.
    expect(screen.getByText("Enabled")).toBeInTheDocument();

    // The row carries a SegmentedControl for language (aria-label = "Language").
    const languageGroups = screen.getAllByRole("group", { name: "Language" });
    expect(languageGroups.length).toBeGreaterThan(0);

    // The segmented control renders two buttons with `aria-pressed`; the
    // currently selected (channel.language === "en") one must be pressed.
    const firstLanguageGroup = languageGroups[0];
    const enOption = firstLanguageGroup.querySelector<HTMLButtonElement>(
      'button[aria-pressed="true"]',
    );
    expect(enOption).not.toBeNull();
    expect(enOption?.textContent).toBe("EN");

    // Row actions: enabled-channel shows "Disable"; delete is always present.
    expect(screen.getByRole("button", { name: "Disable" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("renders add channel form with chatId input, language selector, submit button", () => {
    renderSection();

    // Chat ID is the only text input in the form (numeric inputMode).
    const chatIdInput = screen.getByPlaceholderText("123456789");
    expect(chatIdInput).toBeInTheDocument();
    expect(chatIdInput).toHaveAttribute("type", "text");
    expect(chatIdInput).toHaveAttribute("inputmode", "numeric");

    // The form-level language selector is the only SegmentedControl on the
    // page when there are no channels.
    const languageGroups = screen.getAllByRole("group", { name: "Language" });
    expect(languageGroups.length).toBe(1);

    // Default selected option is "EN" (channel default and form default).
    const pressed = languageGroups[0].querySelector<HTMLButtonElement>(
      'button[aria-pressed="true"]',
    );
    expect(pressed?.textContent).toBe("EN");

    // Submit button is labelled "Add" in the idle state.
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("validates chatId: rejects non-numeric input with error message", async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    mockUseCreateChannel.mockReturnValue({
      mutateAsync,
      isPending: false,
    });

    renderSection();

    const input = screen.getByPlaceholderText("123456789");
    await user.type(input, "abc123");
    await user.click(screen.getByRole("button", { name: "Add" }));

    // The form should report the validation error and never call the
    // mutation — the regex `/^\d+$/` rejects any non-digit characters.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Chat ID must be numeric",
    );
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("calls createChannel.mutateAsync with correct payload on valid form submit", async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    mockUseCreateChannel.mockReturnValue({
      mutateAsync,
      isPending: false,
    });

    // Render with at least one channel so the form-level language selector is
    // distinct from the row-level one — we still want to flip the form's
    // language to "zh" before submitting.
    mockUseChannels.mockReturnValue({
      data: { channels: [sampleChannel] },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderSection();

    const input = screen.getByPlaceholderText("123456789");
    await user.type(input, "987654321");

    // The form-level SegmentedControl is the second group on the page (after
    // the row-level one for the sample channel).
    const languageGroups = screen.getAllByRole("group", { name: "Language" });
    const formLanguageGroup = languageGroups[1];
    const zhButton = formLanguageGroup.querySelector<HTMLButtonElement>(
      'button:not([aria-pressed="true"])',
    );
    expect(zhButton).not.toBeNull();
    await user.click(zhButton as HTMLButtonElement);

    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mutateAsync).toHaveBeenCalledWith({
      channelType: "telegram",
      chatId: "987654321",
      language: "zh",
    });
  });

  it("calls deleteChannel.mutateAsync when delete button is clicked", async () => {
    const user = userEvent.setup();
    const deleteMutateAsync = vi.fn().mockResolvedValue(undefined);
    mockUseDeleteChannel.mockReturnValue({
      mutateAsync: deleteMutateAsync,
      isPending: false,
    });
    mockUseChannels.mockReturnValue({
      data: { channels: [sampleChannel] },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderSection();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(deleteMutateAsync).toHaveBeenCalledWith("ch-1");
  });

  it("calls updateChannel.mutate with `{ enabled: !current }` when enable/disable button is clicked", async () => {
    const user = userEvent.setup();
    const updateMutate = vi.fn();
    mockUseUpdateChannel.mockReturnValue({
      mutate: updateMutate,
      isPending: false,
    });
    mockUseChannels.mockReturnValue({
      data: { channels: [sampleChannel] }, // sampleChannel.enabled === true
      isLoading: false,
      isError: false,
      error: null,
    });

    renderSection();

    await user.click(screen.getByRole("button", { name: "Disable" }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    const [payload, options] = updateMutate.mock.calls[0];
    expect(payload).toEqual({ id: "ch-1", enabled: false });
    expect(typeof options?.onError).toBe("function");
  });

  it("calls updateChannel.mutate with `{ language: \"zh\" }` when language is changed", async () => {
    const user = userEvent.setup();
    const updateMutate = vi.fn();
    mockUseUpdateChannel.mockReturnValue({
      mutate: updateMutate,
      isPending: false,
    });
    mockUseChannels.mockReturnValue({
      data: { channels: [sampleChannel] }, // channel.language === "en"
      isLoading: false,
      isError: false,
      error: null,
    });

    renderSection();

    // The row-level SegmentedControl is the first "Language" group on the page.
    const languageGroups = screen.getAllByRole("group", { name: "Language" });
    const rowLanguageGroup = languageGroups[0];
    const zhButton = rowLanguageGroup.querySelector<HTMLButtonElement>(
      'button:not([aria-pressed="true"])',
    );
    expect(zhButton).not.toBeNull();
    expect(zhButton?.textContent).toBe("中文");

    await user.click(zhButton as HTMLButtonElement);

    expect(updateMutate).toHaveBeenCalledTimes(1);
    const [payload, options] = updateMutate.mock.calls[0];
    expect(payload).toEqual({ id: "ch-1", language: "zh" });
    expect(typeof options?.onError).toBe("function");
  });
});
