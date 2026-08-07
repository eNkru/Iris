# Camoufox sidecar self-heal — implementation plan

## Context

- Task: `.trellis/tasks/08-06-camoufox-sidecar-self-heal`
- Files: `camoufox/server.py` only (currently already modified with improved
  error logging — keep those changes; they are a prerequisite for R6).
- Status: planning. Run `task.py start` after these artifacts are reviewed.

## Checklist

- [ ] 1. Add `HEAL_THRESHOLD = 3` and module state `_consecutive_failures`
      near the existing constants (`SIDECAR_CONCURRENCY`,
      `FETCH_TIMEOUT_SECONDS`).
- [ ] 2. Add `_heal_lock = asyncio.Lock()` in `lifespan` (next to
      `_semaphore`).
- [ ] 3. Add `_recreate_browser()` (mirrors `lifespan` start/stop; guarded by
      `_heal_lock`; idempotent via `_browser is None` check; defensive catch
      around `__aenter__`).
- [ ] 4. Add `_record_fetch_failure()` (increment → at threshold call
      `_recreate_browser()` inside a try/except and reset counter) and
      `_record_fetch_success()` (reset to 0).
- [ ] 5. Wire into `/v1/fetch`: call `_record_fetch_success()` on the success
      path; call `_record_fetch_failure()` on all three failure paths
      (`goto is None`, timeout except, generic except).
- [ ] 6. Update the module docstring/comment to mention self-heal.
- [ ] 7. Syntax check: `python3 -m py_compile camoufox/server.py`.

## Validation

- [ ] 8. Rebuild + restart the sidecar:
      `docker compose up -d --build camoufox`.
- [ ] 9. Verify healthy URL still works:
      `curl -s -X POST http://localhost:8000/v1/fetch -d
      '{"url":"https://www.paknsave.co.nz/shop/product/5015656_ea_000pns?name=doritos-cheese-supreme-corn-chips-party-bag-share-pack"}'
      ` → expect `{"ok":true,...}`.
- [ ] 10. Trigger self-heal: fire 3 failing fetches to an unreachable host
      (e.g. `https://nonexistent-domain-zzz.example/`) → logs show
      "degraded — recreating (self-heal)" then "Camoufox browser recreated".
- [ ] 11. Confirm exactly one recreation log for the 3-failure burst and that
      `/health` recovers to 200.
- [ ] 12. Confirm a single failure does NOT recycle (1 bad + 1 good → good
      succeeds, no "recreating" log).
- [ ] 13. Confirm paknsave PDP still returns a full HTML payload after a
      recycle (fetch the Doritos URL again).

## Review gates

- [ ] 14. Acceptance criteria in `prd.md` all met.
- [ ] 15. `git diff` contains only `camoufox/server.py` changes; no new deps.

## Rollback

- `git checkout camoufox/server.py` (or revert commit) + rebuild sidecar
  (`docker compose up -d --build camoufox`). No data migration.
