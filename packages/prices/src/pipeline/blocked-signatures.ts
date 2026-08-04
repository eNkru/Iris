/**
 * Generic anti-bot WAF signature registry for fetched HTML (design.md §3).
 *
 * Anti-bot systems (Akamai Bot Manager, Cloudflare challenges, …) serve a
 * small "deny" / challenge page instead of the real product page when they
 * detect automated access. These pages carry no price, so letting the AI
 * extract from them wastes a model call and, worse, masks the failure as a
 * genuine "unavailable" — an operator cannot tell anti-bot from out-of-stock.
 *
 * `checkPrice` runs `detectBlockedPage` on every fetched page before the AI is
 * called; a match short-circuits to a clear `{ status: "failed", reason:
 * "Anti-bot WAF deny page (…) — retailer blocks automated access." }` instead.
 *
 * This is intentionally a generic registry (id + predicate), NOT per-retailer
 * code: the same signatures apply to every retailer (performance.md —
 * Anti-pattern: retailer-specific code).
 */

interface BlockedSignature {
  /** Stable identifier surfaced in the failure reason and structured logs. */
  id: string;
  /** True when the HTML is a deny/challenge page served by this anti-bot. */
  test: (html: string) => boolean;
}

/**
 * Known deny-page signatures. Akamai Bot Manager on farmers.co.nz (confirmed
 * live 2026-08-04, re-probed same day) serves several block shapes depending
 * on fingerprint / path:
 *
 * - Hard deny: `/WAF_Deny_Page/` (~5 KB, title "Farmers") — plain headless /
 *   undici, and the post-challenge outcome after stealth fails the behavioral
 *   check (~15 s).
 * - Edge "Access Denied": tiny HTML (`<TITLE>Access Denied</TITLE>`, often
 *   <1 KB / HTTP 403) — common when navigating off the homepage after a soft
 *   pass (category, search, PDP, Intershop AJAX).
 * - Behavioral challenge: `sec-if-cpt-container` (~2.6 KB, no title) — the
 *   intermediate page stealth gets before Akamai decides to deny. Not a real
 *   product page; if fetch returns early we must not treat it as content.
 *
 * Cloudflare challenge pages are intentionally left commented out:
 * Cloudflare-proxied shops currently pass via the JS challenge executed by
 * the real-browser transport, so a deny signature is not needed yet — but the
 * registry stays extensible for the day one appears.
 */
const BLOCKED_SIGNATURES: BlockedSignature[] = [
  {
    id: "akamai-waf",
    test: (html) => html.includes("/WAF_Deny_Page/"),
  },
  {
    id: "akamai-access-denied",
    test: (html) => {
      // Akamai edge HTML is tiny and titles the page "Access Denied".
      // Keep the length cap so a real product page that happens to mention
      // the phrase in body copy is not false-positive.
      if (html.length >= 5_000) return false;
      const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) ?? [])[1] ?? "";
      return /access\s*denied/i.test(title);
    },
  },
  {
    id: "akamai-behavioral-challenge",
    test: (html) =>
      html.includes("sec-if-cpt-container") &&
      html.length < 20_000 &&
      // Real PDPs that embed Akamai scripts still have cart/price chrome.
      !/add to (bag|cart)/i.test(html),
  },
  // {
  //   id: "cloudflare-challenge",
  //   test: (html) => html.includes("cf-chl-bypass"),
  // },
];

/**
 * Return the id of the first matched blocked-page signature, or `null` when
 * the HTML looks like a real page. Run before any AI extraction call.
 */
export function detectBlockedPage(html: string): string | null {
  const signature = BLOCKED_SIGNATURES.find((s) => s.test(html));
  return signature ? signature.id : null;
}
