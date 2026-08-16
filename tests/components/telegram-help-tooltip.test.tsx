import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the i18n hook used by the tooltip. The component imports
// `../lib/i18n`, which resolves to `apps/web/src/lib/i18n` when the
// component is imported from this file via the relative path below.
vi.mock("../../apps/web/src/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "tooltip.aria": "Help",
        "tooltip.title": "How to set up Telegram",
        "tooltip.step1": "Step 1",
        "tooltip.step2": "Step 2",
        "tooltip.step3": "Step 3",
        "tooltip.step4": "Step 4",
      };
      return translations[key] ?? key;
    },
    lang: "en",
    setLang: () => {},
    mounted: true,
  }),
}));

const { TelegramHelpTooltip } = await import(
  "../../apps/web/src/components/telegram-help-tooltip"
);

describe("TelegramHelpTooltip", () => {
  it("renders the trigger button with `?` text and aria-label", () => {
    render(<TelegramHelpTooltip />);

    const trigger = screen.getByRole("button", { name: "Help" });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent("?");
  });

  it("tooltip is hidden by default", () => {
    render(<TelegramHelpTooltip />);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows tooltip with 4 steps on mouseEnter and hides on mouseLeave", async () => {
    const user = userEvent.setup();
    render(<TelegramHelpTooltip />);

    const trigger = screen.getByRole("button", { name: "Help" });

    await user.hover(trigger);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    // Headline comes from `useI18n` (no custom `title` prop here).
    expect(tooltip).toHaveTextContent("How to set up Telegram");
    // Four step list items, rendered in declaration order.
    expect(tooltip.querySelectorAll("li")).toHaveLength(4);
    expect(tooltip).toHaveTextContent("Step 1");
    expect(tooltip).toHaveTextContent("Step 2");
    expect(tooltip).toHaveTextContent("Step 3");
    expect(tooltip).toHaveTextContent("Step 4");

    await user.unhover(trigger);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("renders the custom `title` prop as the tooltip heading", async () => {
    const user = userEvent.setup();
    render(<TelegramHelpTooltip title="Custom setup guide" />);

    await user.hover(screen.getByRole("button", { name: "Help" }));

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Custom setup guide");
    // Translation-provided heading must NOT appear when an override is given.
    expect(tooltip).not.toHaveTextContent("How to set up Telegram");
    // Steps remain translated.
    expect(tooltip.querySelectorAll("li")).toHaveLength(4);
  });

  it("shows tooltip on focus and hides on blur (keyboard accessibility)", async () => {
    const user = userEvent.setup();
    render(<TelegramHelpTooltip />);

    const trigger = screen.getByRole("button", { name: "Help" });
    // Use userEvent.tab() so the simulated focus event propagates through
    // React's synthetic event system (and bubbles to the span's `onFocus`).
    await user.tab();

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent("How to set up Telegram");

    await user.tab(); // moves focus elsewhere → blur

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});