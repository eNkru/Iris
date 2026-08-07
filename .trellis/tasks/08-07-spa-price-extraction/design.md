# Design — SPA price extraction: wait for JS-rendered price

## Context / decision

The sidecar snapshots `page.content()` at `wait_until="domcontentloaded"`. For
client-rendered SPA PDPs (Angular/React), the price is injected by JS *after*
that event, so the snapshot is an empty shell. Experiment results against the
live sidecar on a woolworths PDP (`/shop/productdetails?stockcode=706123`):

| strategy | elapsed | body text len | price visible? |
|---|---|---|---|
| `domcontentloaded` (current) | 3.1 s | **0** | no |
| `+ wait_for_load_state("networkidle", 10s)` | +0.6 s | **0** | no |
| content heuristic (poll `innerText.length > 200`, 8s cap) | 1.5 s | **2727** | yes (name + `$0.00` cart total render) |

Key finding: **`networkidle` does NOT help** — the Angular app reaches network
idle but the price-bearing DOM still isn't in `page.content()` at that point
(the price likely renders from already-fetched data without new network
activity, or the relevant subtree hydrates after the network goes idle). Only a
content-based wait surfaces the rendered text.

## Chosen approach

Generic **content-stabilization wait** after `domcontentloaded`:

1. `page.goto(url, wait_until="domcontentloaded", timeout=45s)` — unchanged
   (keeps the navigation/anti-bot timing identical; this is the load event
   Camoufox already passes challenges under).
2. After goto resolves (and `response` is not None), poll
   `document.body.innerText.length` every 100 ms:
   - lengths below `RENDER_MIN_TEXT_LEN` (200) do **not** start the stability
     clock (SPA chrome stubs of ~9 chars would otherwise "stabilize" early and
     miss the price — confirmed pre-flight 2026-08-07);
   - once above the floor, return when the length is unchanged for
     `RENDER_STABLE_SECONDS` (1 s), or when `RENDER_WAIT_SECONDS` (8 s) elapses.
3. Then `page.content()` as today.

Pre-flight timeline (Angular SPA PDP, stockcode 706123):

| t | body len | note |
|---|---|---|
| 3.0 s | 0 | shell |
| 3.8 s | 9 | chrome stub — must NOT stabilize here |
| 5.8 s | 1930 | real content + product price `$ 39 99` |
| ~15 s | 3449 | fully settled |

### Why content-stabilization over the alternatives

- **`networkidle`**: rejected by experiment (still 0 text). Also penalizes every
  page — `networkidle` waits for 500ms of zero network activity, which fails/long
  on pages with analytics/polling.
- **Per-site selectors** (`page.wait_for_selector('[data-price]')`): explicitly
  forbidden anti-pattern (`backend/performance.md:632`) and non-generic.
- **Fixed `sleep`**: non-adaptive; either too short for slow hydrations or
  wasteful on fast/static pages.
- **Content-stabilization (chosen)**: generic (no selectors/host branching),
  adaptive (returns as soon as the DOM settles), bounded (`RENDER_WAIT_SECONDS`
  cap). The "stabilized for 1 s" rule distinguishes a fully-rendered page from a
  half-hydrated one without site-specific knowledge.

## Boundaries / contracts

- New constant: `RENDER_WAIT_SECONDS = 8.0` — the cap for the post-navigation
  render wait. Bounded well under `FETCH_TIMEOUT_SECONDS` (45 s) so a
  never-rendering page still fails inside the existing timeout envelope.
- The wait runs **only after a successful goto with a non-None response**. The
  `response is None`, timeout, and exception paths are unchanged (R7 in PRD).
- Non-2xx challenge/deny pages: the wait still runs (cheap — a challenge shell
  is tiny and stabilizes immediately), then HTML is returned for app-side
  `detectBlockedPage` classification exactly as today. No behavior change.
- No API change: `/v1/fetch` and `/health` bodies/shapes identical (R6).

## Data flow

```
goto(dcl, 45s) -> [response None? -> fetch_failed (unchanged)]
              -> poll innerText.length every 100ms
                 until (stable ≥1s) or RENDER_WAIT_SECONDS cap
              -> page.content()
              -> FetchResponseOk(html, final_url)   # unchanged
```

## Compatibility / migration

- Static (server-rendered) pages: their text is already present at
  `domcontentloaded`; the poll returns on the first stability check (~100-200 ms
  of extra latency worst case). No regression (AC2).
- SPA pages: now return rendered HTML → extraction works (AC1).
- Anti-bot: navigation timing (`goto` `domcontentloaded`) is unchanged, so the
  stealth behavior Camoufox relies on is preserved. The post-render poll adds
  dwell time but no new network/JS-injection pattern, so it should not trip WAF
  classes. R5 / AC: verify against the previously-passing challenge sites in
  the implement phase.

## Operational / rollback

- Single file change (`camoufox/server.py`) + spec update. Rollback = revert
  the one commit; the `domcontentloaded`-only behavior is restored.
- The render-wait adds at most `RENDER_WAIT_SECONDS` to a fetch in the worst
  (never-stabilizing) case; the app-side `FETCH_TIMEOUT_MS` (45 s) and
  `MAX_RETRIES` envelope still absorb it.
- Telemetry: the existing `non-2xx` WARNING already logs `html_len`; no new
  logging required for this change. (The degradation diagnostics from
  `08-06-camoufox-sidecar-diagnose` remain intact and do not fire here because
  the fetch still returns `{ok:true}`.)

## Risks / tradeoffs

- **Latency**: worst case +8 s on pages that never stabilize. Acceptable: the
  semaphore (5) and app retry/backoff absorb it; the common case returns in
  <1-2 s (experiment: 1.5 s for woolworths).
- **Stability false-positive**: a page that renders header/cart text then stalls
  before the price could "stabilize" at len>200 with no price yet. Mitigation:
  the 1-s stability window + the option to also require a price-looking token
  is deliberately NOT added (would be non-generic / selector-ish). Instead we
  rely on the AI to report `available:false` if the price still isn't there —
  same outcome as today, no worse.
- **Exact price token**: the first experiment saw `$0.00` (cart total), not the
  product price. A stabilization experiment (deferred to implement phase) will
  confirm the real product price renders within the 8 s window; if it renders
  later, `RENDER_WAIT_SECONDS` is the single knob to raise.

## Deferred

- Confirming the exact product-price token renders within the window (implement
  phase, against the live sidecar — the Bash classifier was unavailable during
  planning).
- Enumerating other SPA retailers (paknsave, etc.) to confirm the generic wait
  fixes them too — covered by AC1/AC2 validation in implement.
