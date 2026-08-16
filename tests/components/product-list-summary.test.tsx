import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

/**
 * Tests for the "Send summary" button in `ProductList` (R12.4 / spec
 * `.trellis/spec/backend/notifications-telegram.md`).
 *
 * The component talks to the backend exclusively through React Query hooks.
 * We mock the ones that the summary button exercises (`useSendSummary`) plus
 * the supporting product hooks so the whole component renders without firing
 * any real network request. The i18n hook is also mocked so the assertions
 * can match deterministic English strings.
 */

const {
  mockUseProducts,
  mockUseCheckNow,
  mockUseDeleteProduct,
  mockUseUpdateProduct,
  mockUseSendSummary,
} = vi.hoisted(() => ({
  mockUseProducts: vi.fn(),
  mockUseCheckNow: vi.fn(),
  mockUseDeleteProduct: vi.fn(),
  mockUseUpdateProduct: vi.fn(),
  mockUseSendSummary: vi.fn(),
}));

vi.mock("../../apps/web/src/hooks/use-products", () => ({
  useProducts: mockUseProducts,
  useCheckNow: mockUseCheckNow,
  useDeleteProduct: mockUseDeleteProduct,
  useUpdateProduct: mockUseUpdateProduct,
}));

vi.mock("../../apps/web/src/hooks/use-channels", () => ({
  useSendSummary: mockUseSendSummary,
}));

vi.mock("../../apps/web/src/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      const translations: Record<string, string> = {
        "productList.loading": "Loading products...",
        "productList.loadError": "Failed to load products.",
        "productList.empty": "No products yet",
        "productList.emptyTitle": "Nothing tracked yet",
        "productList.active": "Active",
        "productList.paused": "Paused",
        "productList.noPrice": "No price recorded yet",
        "productList.checked": " checked ",
        "productList.checkNow": "Check now",
        "productList.checking": "Checking...",
        "productList.pause": "Pause",
        "productList.resume": "Resume",
        "productList.delete": "Delete",
        "productList.deleting": "Deleting...",
        "productList.confirmDelete": "Confirm delete",
        "productList.cancel": "Cancel",
        "productList.refresh": "Refresh",
        "productList.deleteError": "Failed to delete product.",
        "productList.sendSummary": "Send summary",
        "productList.sending": "Sending...",
        "productList.summarySent": "Summary sent ({n} {items})",
        "productList.summarySent.one": "item",
        "productList.summarySent.other": "items",
        // TelegramHelpTooltip keys — the summary button sits next to the
        // tooltip trigger, and the component asserts the tooltip is rendered
        // alongside the button.
        "tooltip.aria": "Help",
        "tooltip.title": "How to set up Telegram",
        "tooltip.step1": "Step 1",
        "tooltip.step2": "Step 2",
        "tooltip.step3": "Step 3",
        "tooltip.step4": "Step 4",
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

const { ProductList } = await import(
  "../../apps/web/src/components/product-list"
);

function renderProductList() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProductList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setHookDefaults() {
  // Empty products keep the component on the "no products yet" branch — that
  // branch still renders the summary button via `listToolbar`, so we don't
  // have to mock an entire product row.
  mockUseProducts.mockReturnValue({
    data: { products: [] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseCheckNow.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  mockUseDeleteProduct.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  });
  mockUseUpdateProduct.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  mockUseSendSummary.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
}

describe("ProductList send summary button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setHookDefaults();
  });

  it("renders the 'Send summary' button alongside the Telegram help tooltip", () => {
    renderProductList();

    // The summary button is a `ButtonSecondary` whose idle label comes from
    // `t("productList.sendSummary")` — we mocked that to "Send summary".
    const button = screen.getByRole("button", { name: "Send summary" });
    expect(button).toBeInTheDocument();
    expect(button).toBeEnabled();

    // The button is paired with `TelegramHelpTooltip`; the tooltip's trigger
    // has `aria-label="Help"` (mocked) so its presence proves the tooltip is
    // rendered next to the button.
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
  });

  it("shows a loading spinner on the button when sendSummary.isPending is true", () => {
    // Idle isPending elsewhere; only sendSummary reports pending so the
    // summary button is the only spinner in the rendered toolbar.
    mockUseSendSummary.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
      isError: false,
      error: null,
    });

    const { container } = renderProductList();

    // While pending the button is disabled.
    const button = screen.getByRole("button", { name: /Send summary|Sending/i });
    expect(button).toBeDisabled();

    // The button text becomes the "Sending..." label coming from the mocked
    // i18n; the spinner primitive renders an element with `animate-spin`.
    expect(screen.getByText("Sending...")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();

    // While pending the success box must NOT be shown yet — the success box
    // is gated on `summaryCount !== null`, which only flips via `onSuccess`.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows success feedback with the sent count after mutation success", async () => {
    const user = userEvent.setup();

    // Reproduce the React Query contract: `mutate(variables, options)` invokes
    // `options.onSuccess(data)` when the underlying promise resolves. The
    // component sets `summaryCount` from `data.productsCount`, so we return
    // a `productsCount` of 3 and assert the success box interpolates it.
    const mutateMock = vi.fn(
      (_vars: undefined, opts?: { onSuccess?: (data: unknown) => void }) => {
        opts?.onSuccess?.({ sent: 3, total: 3, productsCount: 3 });
      },
    );
    mockUseSendSummary.mockReturnValue({
      mutate: mutateMock,
      isPending: false,
      isError: false,
      error: null,
    });

    renderProductList();

    await user.click(screen.getByRole("button", { name: "Send summary" }));

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledTimes(1);
    });
    // First arg to `mutate` is `undefined`; options object carries the
    // success/error callbacks the component relies on.
    const [, options] = mutateMock.mock.calls[0];
    expect(typeof options?.onSuccess).toBe("function");

    // Success box is rendered with `role="status"` and contains the
    // interpolated count. With n=3 the plural branch (`.other`) is used, so
    // the message becomes "Summary sent (3 items)".
    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent("Summary sent (3 items)");

    // No error box should accompany a successful mutation.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows error feedback when the mutation fails", async () => {
    const user = userEvent.setup();

    // onError mirrors what React Query invokes when the mutation promise
    // rejects. The component stores `err.message` into `actionError`, which
    // renders an `ErrorBox` with `role="alert"`.
    const mutateMock = vi.fn(
      (
        _vars: undefined,
        opts?: {
          onSuccess?: (data: unknown) => void;
          onError?: (err: Error) => void;
        },
      ) => {
        opts?.onError?.(new Error("send failed"));
      },
    );
    mockUseSendSummary.mockReturnValue({
      mutate: mutateMock,
      isPending: false,
      isError: false,
      error: null,
    });

    renderProductList();

    await user.click(screen.getByRole("button", { name: "Send summary" }));

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledTimes(1);
    });
    const [, options] = mutateMock.mock.calls[0];
    expect(typeof options?.onError).toBe("function");

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("send failed");

    // On error the success box must NOT render.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});