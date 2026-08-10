# Design — Add-URL acceptance tests (sidecar fetch layer)

## Architecture & boundaries

```
host (test runner)  ──HTTP──>  http://localhost:8000/v1/fetch   (Camoufox sidecar, inside the app container)
                              http://localhost:8000/health
                                     │
                                     ▼
                          live Camoufox browser ──> real retailer (plain + akamai)
```

The suite is a **host-side HTTP client**. It talks only to the sidecar's public
fetch API — it imports no app modules and mocks nothing. The only repo change
that lets it run is publishing `8000:8000` in `docker-compose.yml` (dev-only).

Boundary:
- IN: test files, a runner devDependency, a `test:acceptance` script, the dev compose port publish, a `detectBlockedPage` port (see below).
- OUT: any change to the sidecar FastAPI app, any change to `fetchPage`/`checkPrice`/`createProduct`, any auth, any production config (`Dockerfile`, `docs/qnap-deployment.md`).

## Why not exercise the full create→rollback→list flow

`POST /api/rpc/products` is a `protectedProcedure`. The only login is magic-link
(no password, no API token), which needs a capturable SMTP path. The user
explicitly redirected to the sidecar ("are you able to test the sidecar api
directly without the auth?") to avoid that seam. So the suite validates the
fetch + blocked-detection layer — the part of "adding URLs" that actually
differs between plain and akamai sites. The rollback/list logic is left to a
future task once auth is solved.

## Test runner choice

**Vitest** (with the node environment), recommended over the alternatives:

| Option | Verdict |
|---|---|
| **Vitest** | Native ESM/TypeScript (matches the pnpm/turbo TS workspace), zero-config, fast, built-in `fetch` + `AbortSignal.timeout` in Node 22 (the image's base). Fits "separate manual-only script" cleanly. **Chosen.** |
| node:test | No install, but no TS/describe ergonomics and awkward fixtures; cross-package import of the TS registry is painful without a build step. |
| Jest | Extra config for ESM + TS in a pnpm workspace; heavier than needed. |

Vitest installs as a root devDependency so `pnpm test:acceptance` works from the
repo root. Tests live under a top-level `tests/acceptance/` dir (not inside a
package — they're cross-cutting host tests, not unit tests belonging to a
package). That dir is deliberately **outside** the `packages:` globs in
`pnpm-workspace.yaml` (`apps/*`, `packages/*`), so `pnpm -r typecheck`
(per-package `tsc --noEmit`) never typechecks it — the acceptance tests cannot
break the workspace typecheck, matching "must not be in the build pipeline."

## Sharing the blocked-signature registry from TypeScript

The akamai scenario asserts "the returned HTML is a real page *or* a classified
akamai block." To classify, the suite needs `detectBlockedPage`. Options:

1. **Import `@iris/prices`'s `detectBlockedPage` directly** in the test (Vitest
   resolves workspace TS via the existing `transpilePackages`/tsconfig paths).
   Pro: single source of truth — if a signature is added/changed, the tests
   stay accurate. Con: pulls a workspace package into the test, so it is no
   longer "pure HTTP" — but it is read-only reuse of a pure function, which is
   acceptable and more honest than hand-rolling a second regex list that will
   silently drift.

   **Chosen.** `detectBlockedPage` is a pure `(html: string) => string | null`
   with no DB/network side effects — importing it is a test convenience, not a
   seam into production behavior.

2. Re-declare a minimal regex list in the test. Rejected: drifts from the
   registry, defeating the point of asserting "the app would classify this."

## Scenario design

### Plain-site scenario
- URL: a known plain retailer PDP (kogan.co.nz is referenced in
  `blocked-signatures.ts` as a real PDP that contains no anti-bot markers; it is
  the documented counterexample to a false positive). Default, overridable via
  `PLAIN_URL`.
- Assert: `res.ok === true`, `typeof html === "string"`, `html.length > 5000`
  (plain PDPs are multi-hundred-KB; akamai shells are <5 KB by design), and
  `detectBlockedPage(html) === null`.
- Cleanup: none (fetch is stateless).

### Akamai-protected scenario
- URL: a farmers.co.nz PDP (the documented akamai site; confirmed 2026-08-04
  and 2026-08-08). Default, overridable via `AKAMAI_URL`.
- The akamai behavioral challenge is **probabilistic** (~55% pass). So the
  assertion is the *disjunction* of the two valid outcomes:
  - `res.ok === true` AND `detectBlockedPage(html)` returns an `akamai-*` id
    (block surfaced — the scenario's primary intent), OR
  - `res.ok === true` AND `detectBlockedPage(html) === null` AND
    `html.length > 5000` (Akamai let it pass this attempt — a real page).
- The single failing outcome: `ok: false` (`fetch_failed`) or an unrecognized
  tiny shell — both mean the fetch/detection path broke.
- Documented in-test: "Akamai is probabilistic; a pass is a valid outcome."

### Readiness guard (before scenarios)
- `GET /health` must return `200 { status: "ok" }` within a bounded startup
  wait (the sidecar returns `503 { status: "starting" }` while the browser
  launches). Tests poll for up to N seconds, then fail loudly if still
  `503` — so a misconfigured stack surfaces as a failure, not a silent skip.

### Reachability guard
- If `http://localhost:8000` is not connectable at all (compose didn't publish
  `:8000`), the suite fails with a clear message pointing at the dev-only
  compose change — not a generic `ECONNREFUSED` stack trace.

## Config & inputs

- `IRIS_SIDECAR_URL` env (default `http://localhost:8000`) so the suite isn't
  hard-coded; lets a future CI/host override it.
- `PLAIN_URL` and `AKAMAI_URL` envs with sensible documented defaults
  (kogan.co.nz / farmers.co.nz PDPs) so a local run needs no config, but the
  URLs are swappable for a different retailer set.

## dev-only compose change

```yaml
# docker-compose.yml — dev only; NOT in docs/qnap-deployment.md
ports:
  - "3000:3000"
  - "8000:8000"   # dev-only: expose the Camoufox sidecar for acceptance tests
```

The image `EXPOSE` stays `3000` only; `Dockerfile` is untouched. The QNAP
production compose in `docs/qnap-deployment.md` is not changed (it must not
expose the sidecar to the LAN).

## Compatibility / migration

- Adds a root devDependency (vitest) + script. No production dependency changes.
- `pnpm install` after the change is required for the suite to run; the image
  build is unaffected (devDeps are not the test script).
- No database migration, no env changes to running stacks beyond the dev port.

## Trade-offs

- **Sidecar-only scope** buys zero-auth, zero-SMTP, fast, deterministic-ish
  tests at the cost of not covering the `create` rollback/list contract. That
  contract is covered indirectly: `detectBlockedPage` is exactly the function
  `fetchPage` calls to decide `blocked`, which is exactly what `checkPrice`
  uses to roll back. So the test asserts the *predicate* the rollback depends on.
- **Akamai probabilism** means the akamai scenario can assert only a
  disjunction, not a single outcome. This is honest — a hard "must block"
  assertion would be flaky.
- **Live external retailers** means the suite depends on their uptime/network.
  Acceptable for manual acceptance tests; explicitly out of CI.

## Operational / rollback

- To remove the tests: delete `tests/acceptance/`, the vitest devDep, the
  `test:acceptance` script, and the `8000:8000` compose line. Nothing else
  depends on them.
- The dev compose port publish is the only change a running stack sees; removing
  it just makes `:8000` host-unreachable again (the app still reaches it
  internally on `127.0.0.1:8000`).
