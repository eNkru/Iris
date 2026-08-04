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


## Session 3: Anti-bot WAF detection (Farmers / Akamai)

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
