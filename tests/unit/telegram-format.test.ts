import { describe, expect, it } from "vitest";

import {
  escapeTelegramHtml,
  formatPriceAlertMessage,
  formatPriceGrouped,
  formatTelegramLink,
} from "../../packages/prices/src/notifications/format";

/**
 * Baseline notification fixture for `formatPriceAlertMessage` tests.
 * Covers the common path: rise + numeric old/new prices + USD currency.
 */
const notification = {
  productId: "prod-1",
  userId: "user-1",
  productName: "Widget",
  productUrl: "https://example.test/widget",
  currency: "USD",
  oldPrice: 100,
  newPrice: 110,
  direction: "rise" as const,
};

describe("escapeTelegramHtml", () => {
  it("escapes & < > in a mixed string", () => {
    expect(escapeTelegramHtml("Tom & Jerry <script>alert('x')</script>")).toBe(
      "Tom &amp; Jerry &lt;script&gt;alert('x')&lt;/script&gt;",
    );
  });

  it("is a no-op on plain text with no special characters", () => {
    expect(escapeTelegramHtml("Hello world")).toBe("Hello world");
    expect(escapeTelegramHtml("")).toBe("");
    expect(escapeTelegramHtml("123 abc XYZ")).toBe("123 abc XYZ");
  });

  // `escapeTelegramHtml` replaces `&` BEFORE checking for `<`/`>`, so it is
  // NOT idempotent: a string that already contains `&amp;` becomes
  // `&amp;amp;`. This test pins down that behavior so callers know to feed
  // raw (un-escaped) user input, never pre-escaped strings.
  it("does NOT round-trip already-escaped entities (no idempotency)", () => {
    expect(escapeTelegramHtml("&amp;")).toBe("&amp;amp;");
    expect(escapeTelegramHtml("&lt;b&gt;")).toBe("&amp;lt;b&amp;gt;");
  });
});

describe("formatTelegramLink", () => {
  it("wraps the URL in an <a href> tag with an HTML-escaped label", () => {
    expect(formatTelegramLink("https://example.test/x", "View product")).toBe(
      '<a href="https://example.test/x">View product</a>',
    );
  });

  it("escapes double quotes in the href so the attribute stays valid", () => {
    // The href attribute is double-quoted, so a literal `"` in the URL must
    // be replaced with `&quot;` to keep the markup parseable.
    const result = formatTelegramLink('https://example.test/?q="a"', "View");
    expect(result).toBe(
      '<a href="https://example.test/?q=&quot;a&quot;">View</a>',
    );

    // Quotes in the *label* are inside element text (not an attribute), so
    // `escapeTelegramHtml` leaves them as-is — only `&<>`
    // are escaped there.
    const withQuotedLabel = formatTelegramLink(
      "https://example.test/x",
      'Say "hi"',
    );
    expect(withQuotedLabel).toBe('<a href="https://example.test/x">Say "hi"</a>');
  });
});

describe("formatPriceGrouped", () => {
  it("inserts a thousands separator on a 4-digit amount", () => {
    expect(formatPriceGrouped(1999, "USD")).toBe("USD 1,999.00");
  });

  it("preserves a leading minus for negative prices", () => {
    expect(formatPriceGrouped(-250, "USD")).toBe("USD -250.00");
  });

  it("omits the currency prefix when the currency string is empty", () => {
    expect(formatPriceGrouped(1999, "")).toBe("1,999.00");
  });

  it("formats zero as 0.00", () => {
    expect(formatPriceGrouped(0, "USD")).toBe("USD 0.00");
    expect(formatPriceGrouped(0, "")).toBe("0.00");
  });

  it("groups digits in a very large number", () => {
    expect(formatPriceGrouped(1234567.89, "USD")).toBe("USD 1,234,567.89");
  });
});

describe("formatPriceAlertMessage", () => {
  it("renders an English rise message with the 📈 header and 'Price increase'", () => {
    const message = formatPriceAlertMessage(notification, "en");

    expect(message).toContain("📈 <b>Price increase</b>");
    // Old → new grouped prices, no thousands separator needed at 100.
    expect(message).toContain("💰 USD 100.00 → USD 110.00");
    // Rise +10.0%
    expect(message).toContain("(+10.0%)");
    // No (-) on a rise message
    expect(message).not.toContain("(-10.0%)");
    // Clickable link, not a raw URL
    expect(message).toContain(
      '<a href="https://example.test/widget">View product</a>',
    );
    // Product name appears in plain text (escaped here is identity).
    expect(message).toContain("Widget");
  });

  it("renders an English drop message with the 📉 header and 'Price drop'", () => {
    const message = formatPriceAlertMessage(
      {
        ...notification,
        oldPrice: 100,
        newPrice: 95,
        direction: "drop",
      },
      "en",
    );

    expect(message).toContain("📉 <b>Price drop</b>");
    expect(message).toContain("💰 USD 100.00 → USD 95.00");
    expect(message).toContain("(-5.0%)");
  });

  it("renders a Chinese rise message (价格上涨)", () => {
    const message = formatPriceAlertMessage(notification, "zh");

    expect(message).toContain("📈 <b>价格上涨</b>");
    // English fallback prose must not appear in the localized message.
    expect(message).not.toContain("Price increase");
    // The Chinese "View product" link label replaces the English one.
    expect(message).toContain("查看商品");
    expect(message).not.toContain("View product");
  });

  it("renders a Chinese drop message (价格下跌)", () => {
    const message = formatPriceAlertMessage(
      {
        ...notification,
        oldPrice: 100,
        newPrice: 95,
        direction: "drop",
      },
      "zh",
    );

    expect(message).toContain("📉 <b>价格下跌</b>");
    expect(message).not.toContain("Price drop");
  });

  it("uses the localized fallback name when productName is null", () => {
    const enMessage = formatPriceAlertMessage(
      { ...notification, productName: null },
      "en",
    );
    expect(enMessage).toContain("Tracked product");

    const zhMessage = formatPriceAlertMessage(
      { ...notification, productName: null },
      "zh",
    );
    expect(zhMessage).toContain("追踪商品");
  });

  it("escapes HTML special characters in the product name", () => {
    const message = formatPriceAlertMessage(
      {
        ...notification,
        productName: "Foo <bar> & Co.",
      },
      "en",
    );

    // Raw `<`, `>`, `&` must NOT appear from user input.
    expect(message).not.toContain("Foo <bar>");
    expect(message).toContain("Foo &lt;bar&gt; &amp; Co.");
  });

  it("computes the percent change correctly (rise +10.0%, drop -5.0%)", () => {
    const rise = formatPriceAlertMessage(
      { ...notification, oldPrice: 200, newPrice: 221, direction: "rise" },
      "en",
    );
    // (221 - 200)/200 * 100 = 10.5 → rounded to one decimal
    expect(rise).toContain("(+10.5%)");

    const drop = formatPriceAlertMessage(
      { ...notification, oldPrice: 200, newPrice: 190, direction: "drop" },
      "en",
    );
    // (190 - 200)/200 * 100 = -5 → abs 5.0
    expect(drop).toContain("(-5.0%)");
  });

  it("omits the percent suffix when oldPrice is 0", () => {
    const message = formatPriceAlertMessage(
      {
        ...notification,
        oldPrice: 0,
        newPrice: 50,
        direction: "rise",
      },
      "en",
    );

    // No `(...)` percent block at all — division-by-zero would be unsafe.
    expect(message).not.toContain("(+");
    expect(message).not.toContain("(-");
    expect(message).not.toMatch(/\([+-]?\d/);
    // Prices still rendered.
    expect(message).toContain("💰 USD 0.00 → USD 50.00");
  });
});