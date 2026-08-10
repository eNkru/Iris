# Implement — Add-URL acceptance tests (sidecar fetch layer)

## Ordered checklist

1. **Add the dev compose port publish** — `docker-compose.yml`: add
   `- "8000:8000"` under `app.ports`, with a `# dev-only: expose the Camoufox
   sidecar for the acceptance tests; never enable in production` comment. Do
   **not** touch `Dockerfile` `EXPOSE` or `docs/qnap-deployment.md`.

2. **Install vitest as a root devDependency** — `pnpm add -Dw vitest` (root
   workspace, `-D` dev, `-w` root). Pin to a current major. Verify it lands in
   root `package.json` `devDependencies` and `pnpm-lock.yaml` updates.

3. **Add the `test:acceptance` script** — root `package.json`:
   `"test:acceptance": "vitest run --dir tests/acceptance"`. Keep it out of any
   `build`/`pretest`/CI hook — it is manual-only. Add a one-line note in
   `README.md` under the dev section that it needs a running
   `docker compose up --build -d` stack with the dev port published.

4. **Create `tests/acceptance/sidecar-fetch.test.ts`** with:
   - Env-driven config: `IRIS_SIDECAR_URL` (default `http://localhost:8000`),
     `PLAIN_URL` (default a kogan.co.nz PDP), `AKAMAI_URL` (default a
     farmers.co.nz PDP).
   - Reachability guard: a `beforeAll` that hits `GET /health` and fails with a
     clear message if `:8000` is unreachable; a bounded poll (e.g. 60s) that
     fails loudly if `/health` stays `503 { status:"starting" }`.
   - Plain-site test: `POST /v1/fetch { url: PLAIN_URL }`, assert `res.ok === true`,
     `typeof html === "string"`, `html.length > 5000`, and
     `detectBlockedPage(html) === null`.
   - Akamai test: `POST /v1/fetch { url: AKAMAI_URL }`, assert `res.ok === true`
     AND (`detectBlockedPage(html)` is an `akamai-*` id OR (`null` AND
     `html.length > 5000`)). Document the probabilistic pass in a comment.
     Fail on `ok: false` or an unrecognized tiny shell.

5. **Reuse the registry** — import `detectBlockedPage` from
   `@iris/prices/pipeline` (verified: `packages/prices/package.json` exports
   `"./pipeline": "./src/pipeline/index.ts"`, and `pipeline/index.ts` does
   `export * from "./blocked-signatures"`, so `detectBlockedPage` is reachable
   with no source change). No re-export needed.

6. **Validate locally** — bring up the stack: `docker compose up --build -d`,
   wait for health, run `pnpm test:acceptance`. Confirm both scenarios pass
   (akamai may pass-or-block; both are green). Confirm the suite fails loudly if
   the container is down (stop it, rerun, expect a clear reachability failure).

7. **Typecheck** — `pnpm -r typecheck` stays green by construction: the
   `tests/` dir lives at the repo root, outside `apps/*` and `packages/*`
   (the only `packages:` globs in `pnpm-workspace.yaml`), so per-package
   `tsc --noEmit` never sees it. Vitest typechecks the test file itself at run.

## Validation commands

```bash
pnpm install                       # pick up vitest devDep
docker compose up --build -d       # stack with :8000 published (dev)
pnpm test:acceptance               # both scenarios
docker compose stop                 # then rerun → expect loud reachability failure
pnpm test:acceptance               # confirms the guard fails, not skips
pnpm -r typecheck                   # stays green
```

## Risky files / rollback points

- `docker-compose.yml` — the `8000:8000` line is the only stack-visible change.
  Rollback: delete the line. Production QNAP config (`docs/qnap-deployment.md`)
  is never edited, so a prod deploy is unaffected.
- `package.json` / `pnpm-lock.yaml` — devDep + script. Rollback: `pnpm remove -Dw vitest`
  + delete the script + delete `tests/acceptance/`.

## Follow-up checks before `task.py start`

- [x] Confirm the default `PLAIN_URL`/`AKAMAI_URL` values — resolved: kogan.co.nz
  (plain) + farmers.co.nz (akamai), both referenced in `blocked-signatures.ts`.
- [ ] Decide the health-poll bound (start with 60s; tune to the observed
  Camoufox cold-start time) during validation.
