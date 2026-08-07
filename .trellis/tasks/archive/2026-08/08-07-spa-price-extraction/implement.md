# Implement — SPA price extraction: wait for JS-rendered price

## Pre-flight (confirm the design assumption)

Run against the live sidecar container (`docker compose exec camoufox python3 …`)
before editing, to confirm the real product price renders within the wait
window. (The planning-phase experiment confirmed name + `$0.00` render at 1.5 s;
this confirms the actual product price.)

- [ ] Run `/tmp/spa_wait_exp2.py` (content-stabilization, dumps context around
      `steinlager` and all `$X.XX` matches). Confirm the real product price
      (not the `$0.00` cart total) appears in the stabilized snapshot.
- [ ] If the price does NOT render within 8 s, raise `RENDER_WAIT_SECONDS`
      candidate to 12 s and re-run. If still absent, reconsider (the price may
      require interaction/scroll — out of scope; document and stop).

## Implementation checklist (ordered)

- [ ] 1. Add `RENDER_WAIT_SECONDS = 8.0` constant near `FETCH_TIMEOUT_SECONDS`
       in `camoufox/server.py` with a comment linking design.md.
- [ ] 2. Add a `_wait_for_render(page)` async helper: polls
       `document.body.innerText.length` every 100 ms; returns when the length
       is stable (unchanged) for ~1 s OR `RENDER_WAIT_SECONDS` elapses. Never
       raises — wrap any evaluate error in a try/except that just returns
       (the wait is best-effort; a failure to poll must not fail the fetch).
- [ ] 3. Call `_wait_for_render(page)` after the `response is None` check and
       before `page.content()` in the `/v1/fetch` handler.
- [ ] 4. Ensure the non-2xx path still runs the wait (challenge shells
       stabilize immediately) and returns HTML for classification unchanged.
- [ ] 5. Keep all failure paths (`response is None`, `asyncio.TimeoutError`,
       `Exception`) and the diagnostic accounting (`_record_failure` /
       `_record_success`) intact — the wait must not change them.

## Validation commands

```bash
# Compile
python3 -m py_compile camoufox/server.py

# Functional: SPA PDP now carries rendered price
docker compose exec camoufox python3 -c "
import asyncio, re
from camoufox.async_api import AsyncCamoufox
URL='https://www.woolworths.co.nz/shop/productdetails?stockcode=706123&name=steinlager-classic-beer-lager'
async def m():
    async with AsyncCamoufox(headless=True) as b:
        p=await b.new_page()
        await p.goto(URL, wait_until='domcontentloaded', timeout=45000)
        # mimic the new wait
        import time
        last=None; stable=None; t0=time.time()
        while time.time()-t0<8:
            n=await p.evaluate('document.body&&document.body.innerText?document.body.innerText.length:0')
            if n==last:
                if stable is None: stable=time.time()
                elif time.time()-stable>=1: break
            else:
                last=n; stable=None
            await asyncio.sleep(0.1)
        h=await p.content()
        t=re.sub(r'<[^>]+>',' ',re.sub(r'<script[\\s\\S]*?</script>',' ',h,flags=re.I))
        t=re.sub(r'\\s+',' ',t).strip()
        print('len',len(t))
        print('has_price', bool(re.search(r'\\$\\d', t)))
asyncio.run(m())
"

# End-to-end via the sidecar HTTP API: returns ok:true with non-empty body text
curl -s -X POST http://localhost:8000/v1/fetch \
  -H 'content-type: application/json' \
  -d '{"url":"https://www.woolworths.co.nz/shop/productdetails?stockcode=706123&name=steinlager-classic-beer-lager"}' \
  | python3 -c "import sys,json,re; d=json.load(sys.stdin); h=d.get('html',''); t=re.sub(r'<[^>]+>',' ',re.sub(r'<script[\\s\\S]*?</script>',' ',h,flags=re.I)); t=re.sub(r'\\s+',' ',t).strip(); print('ok',d.get('ok'),'text_len',len(t),'has_price',bool(re.search(r'\\$\\d',t)))"

# Regression: a static PDP still extracts (pick a known server-rendered retailer)
# + latency not blown out (should be well under 45s)
curl -s -o /dev/null -w 'static_pdp HTTP %{http_code} %{time_total}s\n' -X POST http://localhost:8000/v1/fetch \
  -H 'content-type: application/json' -d '{"url":"<known-static-pdp-url>"}'

# Anti-bot regression: a previously-passing challenge site still returns ok:true
curl -s -X POST http://localhost:8000/v1/fetch -H 'content-type: application/json' \
  -d '{"url":"<known-challenge-site-pdp>"}' | python3 -c 'import sys,json;print(json.load(sys.stdin).get(\"ok\"))'
```

## Review gates / rollback points

- Commit after step 5 + validation green. Single commit on
  `spa-price-extraction` branch.
- If the anti-bot regression (last validation) regresses: revert immediately —
  do NOT try to "fix" the wait to be stealthier in the same pass; the
  navigation timing is unchanged so a regression here would indicate a deeper
  issue worth a separate look.
- Rollback = `git revert <commit>`; restores `domcontentloaded`-only.

## Spec update (after validation)

- [ ] Update `backend/performance.md` line ~618 (`goto domcontentloaded` →
      `domcontentloaded` + render-stabilization wait) and add a "Pattern: SPA
      render wait" section describing the heuristic, the cap, and why
      `networkidle` was rejected (with the experiment numbers).

## Follow-up checks before `task.py start`

- [ ] `design.md` + `implement.md` present (complex task gate).
- [ ] Pre-flight experiment run (confirms the real price renders).
