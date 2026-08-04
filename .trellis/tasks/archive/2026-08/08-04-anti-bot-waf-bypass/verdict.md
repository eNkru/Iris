# Spike verdict — anti-bot WAF (Akamai) / farmers.co.nz

## Final posture: **Verdict B — detection-only** (evasion still deferred)

Stealth and every free/local retry still fail to deliver a real product page.
Detection remains shipped; `fetch-page.ts` stays on plain Playwright.

---

## Round 1 — 2026-08-04 (original)

**Verdict B.** Standalone scripts from `packages/prices/` against
`https://www.farmers.co.nz/women/accessories/hats-beanings/boston-bailey-suede-cap-espresso-7016377`
(Playwright 1.49.1).

| Attempt | domcontentloaded | after ~15s | after ~30s |
|---|---|---|---|
| Baseline (plain playwright) | deny ~5419 chars | — | — |
| `playwright-extra` + stealth + `--disable-blink-features=AutomationControlled` | behavioral challenge ~2625 (`sec-if-cpt-container`) | **deny** ~5443 `/WAF_Deny_Page/` | deny |
| Manual `addInitScript` only | deny immediately | deny | deny |
| Stealth + manual + click challenge button | challenge (button stays `disabled`) | deny | deny |

Stealth *changes* the response (hard deny → behavioral challenge) but the
challenge evaluates headless Chromium for ~15 s and then serves the same deny
page. Progress button never enables.

---

## Round 2 — 2026-08-04 (user retry: “make farmers work”)

Additional techniques beyond round 1. Same product URL unless noted. Scripts
under `/var/folders/.../T/opencode/farmers-spike*.mjs` (temporary).

| # | Attempt | Result |
|---|---|---|
| A | Stealth + realistic NZ context (UA Chrome 131, viewport 1440×900, `en-NZ`, `Pacific/Auckland`, geolocation Auckland, Accept-Language) + wait 40s + networkidle | dcd: challenge 2625; **20s+: deny 5444** |
| B | Stealth + **homepage warm-up** then product | **Home succeeds** (~430 KB, real title, price tokens). Product: **Access Denied** 526 chars (not WAF_Deny_Page) |
| D | Stealth + **system Chrome** `channel: 'chrome'` (Chrome 150) | challenge → deny 5442 (same as bundled Chromium) |
| E/H | Stealth + Chrome + warm-up + mouse movement during challenge | After home, deeper nav → **Access Denied**; product path blocked |
| F | **Firefox** Playwright 132 (installed for probe) | challenge → deny 5434 (same pattern) |
| G | `--headless=new` | (equivalent to A — still deny) |
| I | Plain Playwright + Chrome channel + NZ context + webdriver init hide | still blocked |
| J | Persistent user-data-dir + Chrome + stealth | still blocked |
| K | Home → category → product (referer chain) | Home OK; **category already WAF deny**; product deny |
| L | In-page click from home (`/women/...`) | Click target → **Access Denied** |
| M | Search UI / `/search` | Search → **Access Denied** |
| N/U | **Headed** system Chrome (visible window) + long wait | challenge → **deny** at 20s / 60s — headed does not help |
| O | `fetch()` product XHR from home context (same cookies) | status 200 tiny challenge script / later 403 Access Denied |
| P | undici bare `fetch` (IP probe) | Product: deny 5361; **Home: 200 ~262 KB real HTML** — IP is not globally blackholed; **path/policy is stricter on PDP/search/category** |
| Q | Click other product ids from home (`/6677530`, …) | **Access Denied** on every product-like path |
| R | Intershop / Demandware-style product API probes from browser | Missing endpoints → 404 real “Page Not Found”; real PDP URLs → 403 Access Denied. Site is **Intershop** (`/INTERSHOP/web/WFS/Farmers-Shop-Site/...`); cart/header AJAX also 403 under automation |
| T | Mobile iPhone UA + touch viewport | challenge → deny |
| Free proxies | `r.jina.ai` reader, Google cache, Wayback | No live price: jina CF-blocked; cache/wayback not usable live product HTML |

### Round-2 analysis

1. **Homepage is soft-allowed** under stealth/Chrome (full HTML + prices on
   marketing cards). That proves the datacenter/residential IP is not a total
   ban — but it is **not** enough for the price pipeline, which needs the
   **product URL** the user pastes.
2. **Product, category, search, and Intershop shop endpoints are hard-blocked**
   for automation: either post-challenge `/WAF_Deny_Page/` or edge
   `Access Denied` (~0.5 KB). In-site clicks and cookie warm-up do not help.
3. **System Chrome, headed mode, Firefox, mobile UA, long waits (60s), mouse
   movement, persistent profiles** all fail the same way.
4. Fingerprint stealth alone is insufficient; Akamai’s **behavioral + path
   policy** on shop URLs defeats free local techniques. Documented next
   escalation remains **residential/mobile proxy** (or a paid anti-bot browser
   service) — still user-deferred for paid infra.

### What changed in code after round 2

- **Still detection-only** — no stealth wired into `fetch-page.ts`.
- Expanded `blocked-signatures.ts` so operators also see clear failures for:
  - `akamai-waf` — `/WAF_Deny_Page/`
  - `akamai-access-denied` — title Access Denied + small HTML
  - `akamai-behavioral-challenge` — `sec-if-cpt-container` intermediate page
- `performance.md` notes updated with round-2 evidence.

### Reproduce

```bash
cd packages/prices
# example: stealth + NZ context
node /tmp/farmers-spike.mjs stealth-nz-context   # if scripts retained
```

Or minimal:

```js
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromium.use(StealthPlugin());
// launch channel:'chrome', NZ context, goto Farmers PDP, wait 20s
// → html.includes('/WAF_Deny_Page/') === true
```
