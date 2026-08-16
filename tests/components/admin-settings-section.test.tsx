import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

/**
 * Tests for the AdminSettingsSection bot-token field (R6/R7).
 *
 * The component talks to the backend through two React Query hooks
 * (`useGlobalSettings`, `useUpdateGlobalSettings`). We mock those hooks so
 * this test stays a pure UI/integration test — no fetches, no QueryClient
 * cache effects, no real mutations. The i18n hook is also mocked so the
 * assertions can match deterministic English strings.
 *
 * Focus: the Telegram bot token field. Other fields (AI base URL, poll
 * interval, AI API key, etc.) are out of scope, but the submit handler
 * validates interval and aiBaseUrl, so submit tests must keep those fields
 * valid.
 */

const { mockUseGlobalSettings, mockUseUpdateGlobalSettings } = vi.hoisted(
  () => ({
    mockUseGlobalSettings: vi.fn(),
    mockUseUpdateGlobalSettings: vi.fn(),
  }),
);

vi.mock("../../apps/web/src/hooks/use-settings", () => ({
  useGlobalSettings: mockUseGlobalSettings,
  useUpdateGlobalSettings: mockUseUpdateGlobalSettings,
}));

vi.mock("../../apps/web/src/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      const translations: Record<string, string> = {
        "adminSettings.loading": "Loading...",
        "adminSettings.loadError": "Failed to load",
        "adminSettings.botTokenLabel": "Bot Token",
        "adminSettings.botTokenPlaceholder": "123456:ABC-DEF...",
        "adminSettings.botTokenStored": "Bot token: {token}",
        "adminSettings.botTokenNone": "No bot token configured",
        "adminSettings.intervalLabel": "Poll interval (minutes)",
        "adminSettings.intervalHint": "How often to check prices",
        "adminSettings.intervalInvalid": "Interval must be a positive integer",
        "adminSettings.aiBaseUrlLabel": "AI Base URL",
        "adminSettings.aiBaseUrlPlaceholder": "https://api.example.com/v1",
        "adminSettings.aiBaseUrlHint": "OpenAI-compatible base URL",
        "adminSettings.aiBaseUrlInvalid": "AI Base URL is invalid",
        "adminSettings.aiApiKeyLabel": "AI API Key",
        "adminSettings.aiApiKeyPlaceholder": "sk-...",
        "adminSettings.aiApiKeyStored": "AI API key: {key}",
        "adminSettings.aiApiKeyNone": "No AI API key configured",
        "adminSettings.aiModelLabel": "AI Model",
        "adminSettings.aiModelPlaceholder": "gpt-4",
        "adminSettings.aiModelHint": "Model name",
        "adminSettings.aiZenHostLabel": "AI Zen Host",
        "adminSettings.aiZenHostPlaceholder": "opencode.ai",
        "adminSettings.aiZenHostHint": "Zen host header",
        "adminSettings.aiUserAgentLabel": "AI User Agent",
        "adminSettings.aiUserAgentPlaceholder": "Mozilla/5.0...",
        "adminSettings.aiUserAgentHint": "User-Agent header",
        "adminSettings.aiClientHeaderLabel": "AI Client Header",
        "adminSettings.aiClientHeaderPlaceholder": "cli",
        "adminSettings.aiClientHeaderHint": "Client header value",
        "adminSettings.saveError": "Save failed",
        "adminSettings.saved": "Saved.",
        "adminSettings.saving": "Saving...",
        "adminSettings.submit": "Save",
      };
      const tmpl = translations[key] ?? key;
      if (vars && typeof tmpl === "string") {
        return tmpl.replace(/\{(\w+)\}/g, (_, name) =>
          String(vars[name] ?? `{${name}}`),
        );
      }
      return tmpl;
    },
    lang: "en",
    setLang: () => {},
    mounted: true,
  }),
}));

const { AdminSettingsSection } = await import(
  "../../apps/web/src/components/admin-settings-section"
);

const defaultSettings = {
  aiBaseUrl: "https://api.openai.com/v1",
  aiApiKey: "",
  aiModel: "gpt-4",
  pollIntervalDefaultMinutes: 60,
  telegramBotToken: "",
  aiZenHost: "opencode.ai",
  aiUserAgent: "",
  aiClientHeader: "",
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
        <AdminSettingsSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setLoadedSettings(overrides: Partial<typeof defaultSettings> = {}) {
  mockUseGlobalSettings.mockReturnValue({
    data: { settings: { ...defaultSettings, ...overrides } },
    isLoading: false,
    isError: false,
    error: null,
  });
}

let mutateAsync: ReturnType<typeof vi.fn>;
function setMutationDefault() {
  mutateAsync = vi.fn().mockResolvedValue({ success: true });
  mockUseUpdateGlobalSettings.mockReturnValue({
    mutateAsync,
    isPending: false,
  });
}

describe("AdminSettingsSection bot token field", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMutationDefault();
  });

  it("shows loading spinner when useGlobalSettings returns isLoading", () => {
    mockUseGlobalSettings.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    });

    const { container } = renderSection();

    // Spinner label resolves via the i18n mock and the `.animate-spin` class
    // proves the Spinner primitive from `ui.tsx` is the one used.
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    // The form is hidden while loading, so the bot-token input is absent.
    expect(screen.queryByLabelText("Bot Token")).not.toBeInTheDocument();
  });

  it("shows error box when useGlobalSettings returns isError", () => {
    mockUseGlobalSettings.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("network down"),
    });

    renderSection();

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("network down");
    // The form is hidden in the error state, so the bot-token input is absent.
    expect(screen.queryByLabelText("Bot Token")).not.toBeInTheDocument();
  });

  it("renders password input for bot token (id=bot-token, type=password)", async () => {
    setLoadedSettings();

    renderSection();

    const botTokenInput = await screen.findByLabelText("Bot Token");
    expect(botTokenInput).toBeInTheDocument();
    expect(botTokenInput).toHaveAttribute("id", "bot-token");
    expect(botTokenInput).toHaveAttribute("type", "password");
    expect(botTokenInput).toHaveAttribute("autoComplete", "off");
    expect(botTokenInput).toHaveAttribute(
      "placeholder",
      "123456:ABC-DEF...",
    );
  });

  it("shows 'stored' hint when telegramBotToken is present in settings", async () => {
    // The backend exposes the masked token (e.g. `•••••xxxx`) when one is
    // stored — the component just passes the value through to the i18n
    // template `adminSettings.botTokenStored`.
    setLoadedSettings({ telegramBotToken: "•••••xxxx" });

    renderSection();

    // Wait for the form to render after data arrives, then assert the hint.
    await screen.findByLabelText("Bot Token");
    expect(
      screen.getByText("Bot token: •••••xxxx"),
    ).toBeInTheDocument();
    // The "none" hint must NOT appear when a token is stored.
    expect(
      screen.queryByText("No bot token configured"),
    ).not.toBeInTheDocument();
  });

  it("shows 'none' hint when telegramBotToken is missing", async () => {
    setLoadedSettings({ telegramBotToken: "" });

    renderSection();

    await screen.findByLabelText("Bot Token");
    expect(screen.getByText("No bot token configured")).toBeInTheDocument();
    // The "stored" template must NOT appear when nothing is stored.
    expect(screen.queryByText(/^Bot token:/)).not.toBeInTheDocument();
  });

  it("on submit with token value: includes telegramBotToken in payload", async () => {
    const user = userEvent.setup();
    setLoadedSettings();

    renderSection();

    const botTokenInput = await screen.findByLabelText("Bot Token");
    await user.type(botTokenInput, "123456:ABC-DEF");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramBotToken: "123456:ABC-DEF",
      }),
    );
  });

  it("on submit with empty token: sends telegramBotToken: undefined in payload", async () => {
    const user = userEvent.setup();
    setLoadedSettings();

    renderSection();

    // Confirm the input is present but leave it empty (default state from
    // `data.settings` ⇒ `setBotToken("")`).
    await screen.findByLabelText("Bot Token");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramBotToken: undefined,
      }),
    );
  });

  it("shows 'Saved.' feedback after successful save", async () => {
    const user = userEvent.setup();
    setLoadedSettings();

    renderSection();

    const botTokenInput = await screen.findByLabelText("Bot Token");
    await user.type(botTokenInput, "123456:ABC-DEF");

    // The "Saved." hint must not be visible before submitting.
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });
});
