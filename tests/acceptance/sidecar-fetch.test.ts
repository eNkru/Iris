import { describe, it, expect, beforeAll } from 'vitest';
import { detectBlockedPage } from '../../packages/prices/src/pipeline/blocked-signatures.js';

// Env-driven config (defaults can be overridden for CI)
const SIDECAR_URL = process.env.IRIS_SIDECAR_URL ?? 'http://localhost:8000';
const PLAIN_URL = process.env.PLAIN_URL ?? 'https://www.thewarehouse.co.nz/p/paseo-luxury-toilet-paper-long-roll-white-3-ply-white-8-pack/R2889564.html';
const AKAMAI_URL = process.env.AKAMAI_URL ?? 'https://www.farmers.co.nz/product/sony-wh1000xm5-wireless-cancelling-headphones-black/734837';

// Increase timeout for slow network/sidecar responses
const TEST_TIMEOUT_MS = 30_000;

// Bounded health-poll: fails loudly if the sidecar stays at 503 {status:"starting"}
async function waitForSidecarReady(url: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        if (body.status === 'ok') return;
      }
    } catch {
      // Sidecar not up yet; keep polling
    }
    await new Promise(r => setTimeout(r, 1_000));
  }
  throw new Error(`Sidecar at ${url} did not become healthy within ${timeoutMs}ms`);
}

async function fetchFromSidecar(url: string): Promise<{ ok: boolean; html: string }> {
  const res = await fetch(`${SIDECAR_URL}/v1/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(50_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sidecar fetch failed with status ${res.status}: ${text}`);
  }
  const body = (await res.json()) as { ok?: boolean; html?: string; reason?: string };
  if (!body.ok) {
    throw new Error(`Sidecar fetch unsuccessful: ${body.reason ?? 'no reason'}`);
  }
  if (typeof body.html !== 'string') {
    throw new Error(`Sidecar returned non-string html: ${JSON.stringify(body)}`);
  }
  return { ok: true, html: body.html };
}

describe('sidecar-fetch acceptance tests', () => {
  beforeAll(async () => {
    // Reachability guard: fail fast if sidecar is unreachable or never healthy
    await waitForSidecarReady(SIDECAR_URL);
  });

  it('fetches a plain (DataDome-protected) URL successfully', async () => {
    const { html } = await fetchFromSidecar(PLAIN_URL);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(5_000);
    // No blocked-page signatures detected
    expect(detectBlockedPage(html)).toBeNull();
  }, TEST_TIMEOUT_MS);

  it('fetches an Akamai-protected URL and either passes or detects a known block', async () => {
    const { html } = await fetchFromSidecar(AKAMAI_URL);
    expect(typeof html).toBe('string');

    const blocked = detectBlockedPage(html);
    if (blocked) {
      // Akamai may serve a block; we must recognise it as an akamai-* id
      expect(blocked).toMatch(/^akamai-/);
    } else {
      // Real page returned; expect non-trivial content
      expect(html.length).toBeGreaterThan(5_000);
    }
    // Document the probabilistic pass: Akamai can also serve a real page on fresh attempts
  }, TEST_TIMEOUT_MS);
});
