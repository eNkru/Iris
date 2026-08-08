/**
 * Generic anti-bot WAF signature registry for fetched HTML (design.md §3).
 *
 * Anti-bot systems (Akamai Bot Manager, Cloudflare challenges, …) serve a
 * small "deny" / challenge page instead of the real product page when they
 * detect automated access. These pages carry no price, so letting the AI
 * extract from them wastes a model call and, worse, masks the failure as a
 * genuine "unavailable" — an operator cannot tell anti-bot from out-of-stock.
 *
 * `fetchPage` runs `detectBlockedPage` on every returned HTML before yielding
 * `ok`; a match becomes the `blocked` variant so `checkPrice` short-circuits to
 * a clear `{ status: "failed", reason: "Anti-bot WAF deny page (…) — retailer
 * blocks automated access." }` instead of wasting an AI call.
 *
 * This is intentionally a generic registry (id + predicate), NOT per-retailer
 * code: the same signatures apply to every retailer (performance.md —
 * Anti-pattern: retailer-specific code).
 *
 * The sidecar transport (Camoufox) classifies returned HTML via this registry
 * so an unsolvable challenge surfaces as a specific anti-bot failure instead of
 * the generic "Page fetch failed" (AC3).
 */

interface BlockedSignature {
  /** Stable identifier surfaced in the failure reason and structured logs. */
  id: string;
  /** True when the HTML is a deny/challenge page served by this anti-bot. */
  test: (html: string) => boolean;
  /**
   * Whether a fresh fetch attempt can plausibly pass this block.
   *
   * Challenge shells (behavioral challenges, captchas, managed challenges)
   * are evaluated per request — a new page often passes where the previous
   * one failed (confirmed live on farmers.co.nz 2026-08-08: the Akamai
   * behavioral challenge passes roughly half of fresh attempts). Final deny
   * pages (WAF deny, edge "Access Denied") are fingerprint-level verdicts;
   * retrying them just burns latency. Defaults to `true` so unknown/new
   * signatures are retried conservatively.
   */
  retryable?: boolean;
}

/**
 * Known deny-page signatures. Akamai Bot Manager on farmers.co.nz (confirmed
 * live 2026-08-04, re-probed 2026-08-08) serves several block shapes depending
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
 * - Empty shell: head-only document (~1.4–2.6 KB, no `<title>`, no `<body>`)
 *   — the pre/aborted-challenge snapshot. Observed 2026-08-08: when the
 *   behavioral challenge is denied the served document can lack the
 *   `sec-if-cpt-container` div entirely.
 *
 * The Akamai behavioral challenge is **probabilistic, not a hard deny**: on
 * 2026-08-08 a batch of fresh headless Camoufox fetches of one farmers PDP
 * returned the real product page (~180–214 KB) on ~55% of attempts and a
 * challenge/shell page on the rest. The challenge never resolves in-place
 * once served (observed 60+ s with no content change), so the mitigation is
 * a fresh attempt (`retryable: true`), not a longer wait.
 *
 * Cloudflare challenge pages are also covered now (confirmed live
 * 2026-08-04): when the sidecar transport cannot pass the challenge, the
 * page contains `_cf_chl_opt` / `cf-chl` / `challenges.cloudflare.com`, or
 * is a small "Just a moment…" interstitial. The real kogan PDP contains
 * none of these markers, so detection is false-positive-free.
 */
const BLOCKED_SIGNATURES: BlockedSignature[] = [
  {
    id: "akamai-waf",
    // Final deny verdict — a fresh attempt is futile (same fingerprint).
    retryable: false,
    test: (html) => html.includes("/WAF_Deny_Page/"),
  },
  {
    id: "akamai-access-denied",
    // Edge-level deny after a soft pass. Earlier treated as a permanent
    // fingerprint verdict (retryable: false), but live behavior on
    // farmers.co.nz (2026-08-08: one PDP fetched fine ~3 min after another
    // PDP served this exact shell) shows the deny is intermittent — Akamai
    // re-evaluates the behavioral signal per request and a fresh attempt
    // often passes. Retrying lifts the effective success rate above the
    // single-attempt pass rate, matching the behavioral-challenge story.
    retryable: true,
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
    // Probabilistic challenge — a fresh page often passes (see file header).
    retryable: true,
    test: (html) =>
      html.includes("sec-if-cpt-container") &&
      html.length < 20_000 &&
      // Real PDPs that embed Akamai scripts still have cart/price chrome.
      !/add to (bag|cart)/i.test(html),
  },
  {
    // DataDome captcha — served when the anti-bot challenge is not solved.
    // The real kogan PDP contains none of these markers, so a real page is
    // never false-positive.
    id: "datadome-captcha",
    test: (html) => html.includes("captcha-delivery.com"),
  },
  {
    // Cloudflare managed challenge interstitial ("Just a moment…").
    //
    // Match only challenge-shell markers — NOT every Cloudflare asset.
    // Real product pages (confirmed pbtech PDP 2026-08-04) embed a Turnstile
    // widget that loads `https://challenges.cloudflare.com/turnstile/v0/api.js`
    // and `/cdn-cgi/challenge-platform/...` while still being a full PDP with
    // price + add-to-cart. Treating bare `challenges.cloudflare.com` as a
    // block was a false positive that rolled create back (AC4 regression).
    //
    // Managed-challenge shells always inject `_cf_chl_opt` / `cf-chl` tokens,
    // or are a tiny "Just a moment…" page. Keep those. Only treat the
    // challenges.cloudflare.com host as a block on small pages (interstitial
    // size), never on multi-hundred-KB PDPs.
    id: "cloudflare-challenge",
    test: (html) => {
      if (html.includes("_cf_chl_opt") || html.includes("cf-chl")) return true;
      if (html.length < 5_000) {
        const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) ?? [])[1] ?? "";
        if (/just a moment/i.test(title)) return true;
        // Tiny interstitial that references the challenges host without the
        // `_cf_chl_opt` token yet (early challenge shell).
        if (html.includes("challenges.cloudflare.com")) return true;
      }
      return false;
    },
  },
  {
    // Head-only empty shell — LAST in the array on purpose: it is the most
    // generic predicate (any tiny page with no <title> and no <body>), so it
    // must never shadow a more specific signature above it. A real page always
    // has a <title> and a <body>; challenge/deny shells observed live on
    // farmers.co.nz 2026-08-08 have neither. Retryable: it is the failed-
    // challenge snapshot, and a fresh attempt often passes.
    id: "akamai-empty-shell",
    retryable: true,
    test: (html) =>
      html.length < 5_000 &&
      !/<title[\s>]/i.test(html) &&
      !/<body[\s>]/i.test(html),
  },
];

/**
 * Return the id of the first matched blocked-page signature, or `null` when
 * the HTML looks like a real page. Run before any AI extraction call.
 */
export function detectBlockedPage(html: string): string | null {
  const signature = BLOCKED_SIGNATURES.find((s) => s.test(html));
  return signature ? signature.id : null;
}

/**
 * Whether a blocked result with the given signature id is worth retrying with
 * a fresh fetch. Unknown ids default to retryable (`true`) so new challenge
 * shapes are never written off without another attempt.
 */
export function isBlockedSignatureRetryable(id: string): boolean {
  const signature = BLOCKED_SIGNATURES.find((s) => s.id === id);
  return signature?.retryable ?? true;
}
