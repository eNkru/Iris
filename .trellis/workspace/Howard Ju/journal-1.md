# Journal - Howard Ju (Part 1)

> AI development session journal
> Started: 2026-07-31

---



## Session 1: Implement price tracker full-stack app

**Date**: 2026-08-01
**Task**: Implement price tracker full-stack app
**Branch**: `main`

### Summary

Implemented the price tracking & alert app end-to-end: 6-workspace monorepo (Next.js 15 + oRPC + Drizzle + better-auth + Vercel AI SDK), AI price-extraction pipeline, scheduler with Redis distributed lock, Telegram-first alert channel registry, web UI (login/products/settings), Docker Compose deployment. All quality gates passed (typecheck/lint/build). Updated .trellis specs with lessons: better-auth user.id is text not uuid, Drizzle numeric coercion, oRPC FetchHandler mount, instrumentation edge-runtime guard.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `15b94e6` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: Fix Playwright deployment: module resolution + glibc Docker base

**Date**: 2026-08-03
**Task**: Fix Playwright deployment: module resolution + glibc Docker base
**Branch**: `feat/playwright-page-fetch`

### Summary

Fixed two deployment bugs preventing Playwright from running in Docker: (1) the custom ignorePlaywrightPlugin in next.config.ts was generating a throw stub instead of externalizing the module — removed it and relied on serverExternalPackages; (2) node:22-alpine (musl) cannot run Playwright's glibc-linked chromium binary — switched to node:22-bookworm-slim with playwright install --with-deps. Also added playwright to apps/web/package.json for runtime module resolution. Updated the performance spec to reflect the Playwright architecture.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `dc79974` | (see git log) |
| `2dd1c05` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: Generic OpenAI-compatible AI config

**Date**: 2026-08-04
**Task**: Generic OpenAI-compatible AI config
**Branch**: `main`

### Summary

Replaced the 4-way AI provider enum (openai/gemini/anthropic/opencode) + per-provider SDK switch with a single generic OpenAI-compatible config (base URL + API key + model), all admin-editable in global_settings (key masked on read) with env fallbacks. Collapsed the 3 migrations into a single 0000_initial baseline. Unified the extraction pipeline on generateText + fetchPage tool (no generateObject branch). Fixed a schema-validation crash where DeepSeek's available:false + null price/name responses were rejected — priceExtractionSchema is now a discriminated union on available. Removed @ai-sdk/openai/google/anthropic deps. Updated .env.example, docker-compose, next.config, and the ai-sdk-integration spec. PR #4 merged to main. Also brainstormed (not yet implemented) a follow-up anti-bot-waf-bypass task for Akamai-protected retailers (Farmers serves a WAF deny page to headless Chromium).

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `074ddc1` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: Anti-bot WAF detection (Farmers / Akamai)

**Date**: 2026-08-04
**Task**: Anti-bot WAF detection (Farmers / Akamai)
**Branch**: `feat/anti-bot-waf-detection`

### Summary

Shipped detection-only anti-bot WAF handling for the price pipeline after two Farmers spike rounds failed free/local stealth. Added blocked-signatures (akamai-waf, access-denied, behavioral-challenge), short-circuit in checkPrice, performance.md update, branch/PR #5, archived 08-04-anti-bot-waf-bypass.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `bb15ab2` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: Camoufox-only fetch transport (hard anti-bot bypass)

**Date**: 2026-08-05
**Task**: Camoufox-only fetch transport (hard anti-bot bypass)
**Branch**: `main`

### Summary

Replaced Playwright Chromium with a required Camoufox sidecar as the single page-fetch transport so DataDome (kogan), Cloudflare managed (noelleeming), and Akamai (farmers) PDPs can be added. Extended blocked-signatures for DataDome/Cloudflare (tightened to avoid Turnstile false positives on pbtech), rewrote fetch-page as a sidecar HTTP client with ok/blocked/null results, switched checkPrice AI extract to preloaded HTML (single generateText) to avoid DeepSeek multi-step reasoning_content failures, removed Playwright from the app image, and shipped camoufox/ + compose wiring. PR #6 merged to main.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `f922440` | (see git log) |
| `99864f2` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 6: Frontend UX/UI review fixes

**Date**: 2026-08-05
**Task**: Frontend UX/UI review fixes
**Branch**: `main`

### Summary

Applied the 2026-08-05 UX/UI review of the Iris web app (apps/web), pure-frontend. Fixed misleading states: per-row pending action state in the product list (R1), inline check-now error on product detail (R2), silent alert-config warning (R3). UX gaps: Paused badge + muted styling (R4), inline delete confirm replacing window.confirm (R5), relative last-checked times + 30s auto-refresh (R6), Telegram chat-id guidance (R7), transient 3s 'Saved.' feedback on all three settings forms (R8). Polish/a11y: Intl.NumberFormat formatPrice with try/catch fallback (R9), new dependency-free SegmentedControl for chart range (R10), chart currency context (R11), focus-visible rings on buttons + nav links (R12), detail title falls back to URL (R13), login copy + spam hint + resend path (R14), app/icon.svg favicon (R15). All AC1-AC16 pass; typecheck + lint clean. Updated frontend specs with transient-feedback and per-row-pending patterns.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `8924b1f` | (see git log) |
| `3066e42` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete
