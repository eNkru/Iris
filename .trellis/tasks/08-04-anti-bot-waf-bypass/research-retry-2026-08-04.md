# Research note — Farmers retry (2026-08-04)

See `verdict.md` for the full attempt table. Summary for parent session:

**Farmers product pages still do not work** with free/local techniques.

- Homepage: often full HTML under stealth/Chrome.
- Product / category / search / Intershop shop paths: Akamai deny or Access Denied.
- Headed Chrome, system Chrome, Firefox, NZ locale, warm-up, mouse, long wait: no PDP.
- IP not totally banned (home works); path policy + behavioral check block the pipeline URL.

**Code change this retry:** expanded `blocked-signatures.ts` only (detection-only still).
**Not done:** wire stealth into `fetch-page.ts` (gate failed again).

**Next step if user wants Farmers live:** residential/mobile proxy (or paid anti-detect browser egress), still global transport if adopted — no per-hostname branch.
