# Implementation Plan — pbtech.co.nz fetch support

## Goal recap

Make `fetchPage` deliver pbtech HTML (bypassing Cloudflare Managed Security
Challenge) so `create.ts`'s first sync check succeeds instead of rolling back.
Target URL:
`https://www.pbtech.co.nz/product/NBKHNB161049/HP-HyperX-OMEN-16-ap1049AX-NVIDIA-GeForce-RTX-5060`
(JSON-LD `price: 4999`, `priceCurrency: NZD`).

## Checklist (order matters)

1. **Install browser-TLS lib** in `packages/prices`.
   - Add `wreq-js` to `packages/prices/package.json` dependencies.
   - `pnpm install`; verify it resolves native artifacts.
   - Approve its build script in `pnpm-workspace.yaml` `allowBuilds` (NAPI).
2. **Verify musl/alpine artifact** (deploy risk gate):
   - Confirm `node:22-alpine` can require the lib; if it needs Rust, update
     Dockerfile to a multi-stage build producing the `.node` artifact, and
     test `docker compose up --build` locally.
3. **Implement fallback transport** in `packages/prices/src/pipeline/fetch-page.ts`:
   - Keep undici primary (no regression).
   - When status ∈ {403, 503} (Cloudflare challenge), retry with `wreq-js`
     session using a Chrome (~130) profile.
   - Keep shared `pageFetchLimiter` + retry/backoff/logging; alternate transport
     yields same `{ html, url }` on success, `null` on total failure.
4. **Network proof**:
   - Node script calling `fetchPage` on the pbtech URL → assert `200`/html with
     `"price": 4999` present.
5. **Extraction path**: confirm `aiExtract` (JSON-LD / visible text) returns
   name+NZD price for the fetched HTML (no change expected, but gate on it).
6. **Regression**: run an existing retailer URL (non-pbtech) through `fetchPage`
   to confirm undici path unaffected.

## Validation commands

- `pnpm --filter @iris/prices typecheck`
- `pnpm --filter @iris/prices lint`
- Network proof (step 4/5/6) via a temporary Node script (delete after).
- `docker compose build app` to validate the native artifact in-alpine.

## Risky files / rollback points

- `packages/prices/src/pipeline/fetch-page.ts` — only file with behavior change.
- `packages/prices/package.json` + `pnpm-lock.yaml` — dep additions.
- `pnpm-workspace.yaml` — allowBuilds.
- `Dockerfile` — possibly a new Rust build stage (only if no prebuilt musl).

Roll back by reverting these files; single unit, low blast radius.

## Follow-up gates before `task.py start`

- [ ] Virtualized/NATive lib installs cleanly (or Dockerfile build stage added).
- [ ] `fetchPage` proof-of-work returns 200 + price string for pbtech URL.
- [ ] Existing retailer regression passes.