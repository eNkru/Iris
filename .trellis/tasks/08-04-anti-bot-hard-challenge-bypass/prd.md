# Broad anti-bot bypass: Camoufox-only fetch transport

## Goal

Let the user add product URLs from more NZ retailers. Today several major
retailers sit behind hard anti-bot challenges that the plain Playwright
transport cannot pass, so `create` fails with the generic "Page fetch failed"
and the product is rolled back.

## Confirmed facts (2026-08-04 probes)

- Current transport: plain `chromium.launch({ headless: true })` with no
  fingerprint hardening (`packages/prices/src/pipeline/fetch-page.ts:69`).
- Probe results (Playwright 1.49.1, real Chrome UA + webdriver-hide + NZ
  locale/timezone, both headless and headed):

  | Site | Result | Cause |
  |------|--------|-------|
  | kogan.com | 403 (DataDome captcha); headed returns "Captcha Challenge" shell, no price text | DataDome |
  | thewarehouse.co.nz | **200 OK — works** with real product URL (e.g. `/p/…/R2502647.html`); 404 pages are Cloudflare-challenged but real PDPs pass | passes |
  | noelleeming.co.nz | 403 "Just a moment…" on real PDP (e.g. `/p/ninja-luxe-…/N244950.html`) even hardened/headed | Cloudflare managed challenge |
  | farmers.co.nz | deny page | Akamai Bot Manager (round-2 verdict) |
  | bunnings.co.nz | 200 OK | passes |
  | pbtech.co.nz | 200 OK | passes |
  | 99bikes.co.nz | 200 OK, real PDP with price ($1,988.00) | passes |

- Prior spike verdict (`08-04-anti-bot-waf-bypass/verdict.md`): free/local
  stealth (playwright-extra, system Chrome, Firefox, headed, mobile UA, mouse
  movement, persistent profile, warm-up) all fail against Akamai product/category
  paths. It concluded the next escalation was a **paid** service.
- `blocked-signatures.ts` detects Akamai deny shapes but not DataDome or
  Cloudflare challenge pages, so those currently surface as generic "Page fetch
  failed" instead of a clear anti-bot reason.

## Spike result — Camoufox (2026-08-04, free, supersedes the "paid required" assumption)

**Camoufox v152.0.4-beta.28 (headless) passes every previously-blocked site,
including the farmers PDP that the prior Akamai verdict proved hard-blocked.**

| Site | Plain Playwright | Camoufox (headless, free) |
|------|------------------|---------------------------|
| kogan.com (DataDome) | 403 / "Captcha Challenge" shell | 200 real PDP, price $199.98 |
| noelleeming.co.nz (Cloudflare) | 403 "Just a moment…" | 200 real PDP, price $917.00 |
| farmers.co.nz (Akamai) | /WAF_Deny_Page/ or Access Denied | 200 real PDP, $24.99, not blocked |

Camoufox is a Firefox-based anti-detect browser with C++-engine-level
fingerprinting (not JS patches) — the engine Byparr is built on. Open source,
self-hosted, free. Real kogan PDPs contain none of the challenge markers
(`captcha-delivery.com`, `_cf_chl`, etc.), so challenge detection is
false-positive-free.

## Requirements

- R1: Adding a URL must succeed (return a first price reading) for retailers
  behind hard anti-bot challenges where feasible.
- R2: When a retailer cannot be fetched even after configured fallbacks, the
  failure reason must be specific ("site blocks automated access / challenge
  not solvable") rather than the generic "Page fetch failed".
- R3: Existing pass-through retailers (bunnings, pbtech, warehouse, 99bikes,
  and others) must keep working with the same price-extraction quality.
- R4: **Camoufox is the single fetch transport.** Playwright/Chromium is
  removed from the app. The sidecar is a required dependency in all
  environments (dev and prod).

## Acceptance Criteria

- [ ] AC1: A URL from a DataDome-protected site (e.g. kogan.com) yields a price
      and the product is added.
- [ ] AC2: A URL from a Cloudflare-managed site (e.g. noelleeming.co.nz) yields
      a price and the product is added.
- [ ] AC3: A URL that is still unsolvable returns a specific anti-bot reason,
      not "Page fetch failed".
- [ ] AC4: `thewarehouse.co.nz`, `bunnings.co.nz`, `pbtech.co.nz`, and
      `99bikes.co.nz` continue to add successfully.
- [ ] AC5: The app boots only when `CAMOUFOX_SIDECAR_URL` is set and the sidecar
      is reachable; an unreachable sidecar yields a clear logged error, not a
      silent misconfiguration.

## Key decisions

- **Transport**: Camoufox is the **only** fetch transport. No Playwright/Chromium
  in the app anymore. `fetch-page.ts` becomes a thin client for the sidecar HTTP
  API, keeping the retry/backoff/pLimit/logging envelope.
- **Deployment**: Docker sidecar service (`camoufox/` dir). Camoufox ships
  `linux/arm64` builds, so ARM NAS works. Browser deps move out of the app image
  into the sidecar image (smaller app image).
- **Config**: `CAMOUFOX_SIDECAR_URL` required in `env.ts`; `.env.example` updated.
- **Specific errors**: extend `blocked-signatures.ts` with DataDome + Cloudflare
  entries; the sidecar client classifies returned HTML so AC3 holds.
- **Concurrency**: sidecar semaphore matches the old Playwright concurrency (5)
  so scheduler batch checks and the `ai-extract` re-fetch stay parallel.

## Out of scope

- Per-retailer scraper code (generic transport only, performance.md rule).
- CAPTCHA solving UI / headless-challenge manual intervention flows.
- Paid scraping APIs (not needed after the spike; Camoufox covers all three
  challenge classes for free).
- Interactive steering (click/form automation) — the sidecar API is
  fetch-only for now, designed to grow a click/navigate endpoint later if a
  retailer requires interaction.

## Risks

- **Single point of failure**: Camoufox is a beta Firefox fork. If it regresses
  on a site, there is no second transport. Accepted by the user (strategy
  decision 2026-08-04). Detection still reports a specific reason, so a
  regression is visible, not silent.
- **Browser-popularity edge**: sites scoring on market share may treat Firefox
  (~3%) differently than Chromium. Generally favors us (fewer automated-Firefox
  signatures); theoretical only.
- **Local dev requires the sidecar**: `pnpm dev` needs the sidecar running
  (Docker or a local venv). Documented in `.env.example` / README notes.
- Sidecar adds a second browser image (~400 MB) + Python runtime; app image
  shrinks correspondingly.
- Rollback: reverting the PR restores Playwright; no DB schema change.
