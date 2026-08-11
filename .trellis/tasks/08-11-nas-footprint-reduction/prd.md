# Iris NAS footprint reduction backlog

## Goal

Umbrella backlog of candidate improvements to reduce Iris container idle footprint on resource-constrained hosts (NAS). Owns the ranked candidate list and task map. This task is **not** itself an implementation target — it is the catalog. A child task is spawned (planned + started) only when an item below is picked for implementation.

Today's baseline (measured on a running container at rest): **~823 MB RAM, ~5% CPU, 1.95 GB image**. Of that, the always-resident Firefox browser tree is ~350-500 MB / ~2.5% CPU and ~1 GB of the image; Next.js ~170 MB / ~550 MB image; uvicorn+Python ~140 MB / ~300 MB image.

## Candidate improvements (ranked by idle-RAM saved vs. effort/risk)

### Tier A — high savings, contained scope

#### A1. On-demand camoufox browser lifecycle (lazy launch + idle teardown)
- **Saves:** ~350-500 MB idle RAM (the resident Firefox tree), ~2.5% CPU.
- **Cost/effort:** Low. Single file (`camoufox/server.py`), runtime-only change, no image rebuild, no app-client change.
- **Risk:** Low. Anti-detect capability unchanged; first fetch after idle pays ~3-5s cold-start inside the existing 45s envelope.
- **Tradeoffs:** Slightly slower first scrape after an idle period.
- **Status:** **ALREADY TASKED** — `.trellis/tasks/08-11-lazy-camoufox-browser` (planning complete, ready to start).
- **Notes:** The highest-leverage single change. Do this first.

#### A2. Split camoufox into a separate Docker compose service (with profiles)
- **Saves:** ~140-300 MB idle RAM (uvicorn + Python interpreter + venv not resident in the always-on app container), smaller app image.
- **Cost/effort:** Medium. New service in `docker-compose.yml`, restructure `supervisord.conf`/`Dockerfile`, handle the sidecar URL (already `CAMOUFOX_SIDECAR_URL=http://127.0.0.1:8000` → becomes the service name).
- **Risk:** Medium. Two containers to manage; the app must tolerate the sidecar being briefly absent (it already retries/backoffs in `fetch-page.ts`).
- **Tradeoffs:** Operationally two units instead of one; the sidecar still needs to be running for scrapes to work (it is NOT auto start/stop by itself — see A3).
- **Status:** Not yet tasked.

#### A3. Auto start/stop the camoufox sidecar on scrape demand
- **Saves:** ~500 MB idle RAM (full camoufox container gone between scrapes).
- **Cost/effort:** Medium-high. Docker does NOT start/stop on demand by itself; requires orchestration (host-side script/cron, Docker socket API from the app, or a systemd socket-activated unit).
- **Risk:** Medium-high. Cold-start latency ~5-10s per scrape; race between start and first request; socket-permission/security surface.
- **Tradeoffs:** More operationally fiddly and slower than in-process lazy lifecycle (A1). **Superseded by A1** for the in-process case — only worth it if camoufox is already split out (A2) and you want the whole container gone, not just the browser.
- **Status:** Not yet tasked. Lower priority than A1.

### Tier B — moderate savings, broader scope

#### B1. Replace Next.js with a lighter web framework (Astro / SvelteKit / Express+HTMX)
- **Saves:** ~80-120 MB idle RAM, smaller app image (~150-300 MB less node_modules).
- **Cost/effort:** High. Full frontend rewrite (routing, RSC/server actions, oRPC handlers, the auth flow, middleware).
- **Risk:** High. Touches every app surface; large regression surface.
- **Tradeoffs:** Large rewrite for ~12% of the footprint. Not worth doing for footprint alone — only if there's a separate reason to leave Next.js.
- **Status:** Not yet tasked. **Not recommended** for the NAS-footprint motivation alone.

#### B2. Reduce uvicorn/FastAPI sidecar footprint
- **Saves:** ~30-50 MB idle RAM (drop FastAPI for bare ASGI; slim the Python deps).
- **Cost/effort:** Low-medium. Rewrite `server.py` handlers onto bare `starlette`/ASGI.
- **Risk:** Low-medium. Loses Pydantic validation niceties; small surface (2 endpoints).
- **Tradeoffs:** Marginal savings (~30-50 MB) since Python interpreter + camoufox driver are the floor, and uvicorn is already ~100 MB total. Mostly negated if A1 is done (the browser, not uvicorn, dominates).
- **Status:** Not yet tasked. Low priority.

#### B3. Tune the scheduler tick and product poll intervals
- **Saves:** Minor. Reduces idle wakeups and per-tick DB query cost; negligible RAM, small CPU-avg reduction.
- **Cost/effort:** Trivial. Env-var change (`SCHEDULER_TICK_MS` 30000 → 300000; review `DEFAULT_INTERVAL_MINUTES`).
- **Risk:** None.
- **Tradeoffs:** Scrapes happen a bit less promptly. Purely a tuning knob.
- **Status:** Not yet tasked. Trivial; can be done any time without a task.

### Tier C — image-size savings (disk, not RAM — but matters on small NAS storage)

#### C1. Multi-stage Docker build to shed build-time deps from the final image
- **Saves:** Image size only (disk/pull time), not idle RAM.
- **Cost/effort:** Medium. Restructure `Dockerfile` into builder + runtime stages; ensure only runtime artifacts land in the final image.
- **Risk:** Low-medium. Build-correctness regressions.
- **Tradeoffs:** Doesn't help the running-footprint problem, only image size. Worth doing if storage/pull time matters on the NAS.
- **Status:** Not yet tasked.

#### C2. Shared slim base / remove unused system libs
- **Saves:** Image size. The 473 MB apt layer (GTK/NSS/X11) exists solely to support Firefox — cannot remove while camoufox stays. The 540 MB `pnpm install` layer could be pruned of devDependencies in the runtime stage.
- **Cost/effort:** Low-medium (devDeps prune); High (system libs are required by camoufox).
- **Risk:** Low (devDeps) / High (system libs tied to camoufox).
- **Tradeoffs:** devDeps prune is safe and easy; system-lib removal is blocked by camoufox.
- **Status:** Not yet tasked.

### Tier D — capability tradeoffs (change what the app does)

#### D1. Replace camoufox with a scraping API (ScrapingBee / ZenRows / ScraperAPI / Browserless)
- **Saves:** ~500 MB idle RAM + ~1 GB image (drop the entire camoufox stack).
- **Cost/effort:** Medium. Replace `fetch-page.ts`'s transport to call the API; remove camoufox service/Dockerfile/supervisord.
- **Risk:** Low technical; introduces a paid dependency and per-request cost.
- **Tradeoffs:** Trades NAS resources for $ cost (~few $/month for a home project with few products). Keeps anti-detect capability via the API's browser farm.
- **Status:** Not yet tasked. Viable if you'd rather pay a few dollars than run Firefox on the NAS.

#### D2. Remote camoufox on a separate beefier box (cloud VM / always-on server)
- **Saves:** ~500 MB idle RAM + ~1 GB image on the NAS (camoufox moves off-box).
- **Cost/effort:** Low-medium. Run camoufox on a $5 cloud VM; point `CAMOUFOX_SIDECAR_URL` at it instead of `127.0.0.1:8000`.
- **Risk:** Low. The app already treats the sidecar as an HTTP dependency with retries.
- **Tradeoffs:** Adds a second machine + network dependency + cost (VM). NAS stays light; camoufox has room to breathe elsewhere.
- **Status:** Not yet tasked.

#### D3. Merge camoufox into the Node process (drop Python sidecar) via plain Playwright
- **Saves:** ~300-500 MB idle RAM + ~300 MB image (no Python interpreter/venv/uvicorn; one Node process).
- **Cost/effort:** High. Rewrite `server.py` scraping into Node + Playwright; remove the sidecar.
- **Risk:** High — **capability regression**. Plain Playwright gets blocked by DataDome/Akamai/Cloudflare (the whole reason camoufox exists). This undoes the anti-detect capability that's core to the app.
- **Tradeoffs:** Saves resources but breaks the primary feature. **Not recommended** unless the anti-bot requirement is dropped.
- **Status:** Not yet tasked. **Not recommended.**

## Recommended sequencing

1. **A1 (lazy browser)** — already planned. Do this first; biggest single win, lowest risk. ~350-500 MB saved at idle.
2. **B3 (scheduler tuning)** — trivial, do alongside A1 if desired. Near-zero savings but free.
3. **A2 (split compose service)** — next, if A1 isn't enough. ~140-300 MB more.
4. **C1/C2 (image slimming)** — if NAS storage/pull time matters; independent of RAM.
5. **D1 or D2 (offload scraping)** — only if the on-NAS camoufox footprint is still unacceptable after A1+A2, and you're willing to pay $ or run a second box.
6. **B1 (framework swap)** — only for a reason beyond footprint (not recommended for footprint alone).
7. **A3, B2, D3** — generally not recommended (superseded, marginal, or capability-breaking).

## Acceptance Criteria (for this backlog task itself)

- [ ] Every candidate that surfaced in the footprint discussion is recorded above with savings, effort, risk, tradeoffs, and status.
- [ ] Each candidate has a clear "do this when..." trigger so picking is unambiguous.
- [ ] The already-tasked item (A1) is cross-referenced to its task directory.

## Notes

- This is a catalog, not an implementation. Do **not** `task.py start` this parent. Spawn a child (with `--parent .trellis/tasks/08-11-nas-footprint-reduction`) when an item is picked.
- Candidate savings are estimates from the measured baseline; re-measure after each implemented item since they interact (e.g. A1 makes B2's payoff smaller).
- Capabilities (anti-detect scraping) must be the gating constraint — see D3/D1: anything that breaks DataDome/Akamai bypass is out of scope for a "footprint" task unless explicitly re-scoped.
