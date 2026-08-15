import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.CAMOUFOX_SIDECAR_URL = "http://127.0.0.1:8000";
// Module-load-time value used as a fallback in afterEach when IMAGES_DIR was
// never set in the parent environment before the test ran.
const ORIGINAL_IMAGES_DIR = "data/images-test-vitest";
process.env.IMAGES_DIR = ORIGINAL_IMAGES_DIR;

import { resetEnvCache } from "@iris/utils";
import {
  downloadProductImage,
  validateImageBuffer,
} from "../../packages/prices/src/pipeline/extract-image";

resetEnvCache();

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const GIF87A = Buffer.concat([Buffer.from("GIF"), Buffer.from("87a")]);
const GIF89A = Buffer.concat([Buffer.from("GIF"), Buffer.from("89a")]);
const WEBP_BYTES = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x10, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP"),
]);
const AVIF_BYTES = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("ftyp"),
  Buffer.from("avif"),
]);

function fakeFetchResponses(responses: Array<() => Response | Error>) {
  let i = 0;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const spy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses[i++];
    if (!next) {
      throw new Error(`no more fake responses scheduled (call #${i})`);
    }
    const value = next();
    if (value instanceof Error) throw value;
    return value;
  });
  vi.stubGlobal("fetch", spy);
  return { spy, calls };
}

function sidecarJsonOk(contentType: string, data: string): Response {
  return new Response(
    JSON.stringify({ ok: true, contentType, data }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function sidecarJsonFail(reason: string): Response {
  return new Response(
    JSON.stringify({ ok: false, reason }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function sidecarHttpError(status: number): Response {
  return new Response("bad", { status });
}

describe("validateImageBuffer", () => {
  it("accepts JPEG with the JPEG magic prefix", () => {
    expect(validateImageBuffer(JPEG_BYTES, "image/jpeg")).toEqual({
      ext: ".jpg",
      contentType: "image/jpeg",
    });
  });

  it("accepts PNG with the full PNG magic", () => {
    expect(validateImageBuffer(PNG_BYTES, "image/png")).toEqual({
      ext: ".png",
      contentType: "image/png",
    });
  });

  it("accepts GIF87a and GIF89a", () => {
    expect(validateImageBuffer(GIF87A, "image/gif")).toEqual({
      ext: ".gif",
      contentType: "image/gif",
    });
    expect(validateImageBuffer(GIF89A, "image/gif")).toEqual({
      ext: ".gif",
      contentType: "image/gif",
    });
  });

  it("accepts WebP via RIFF + WEBP continuation at offset 8", () => {
    expect(validateImageBuffer(WEBP_BYTES, "image/webp")).toEqual({
      ext: ".webp",
      contentType: "image/webp",
    });
  });

  it("accepts AVIF via ISOBMFF ftyp box", () => {
    expect(validateImageBuffer(AVIF_BYTES, "image/avif")).toEqual({
      ext: ".avif",
      contentType: "image/avif",
    });
  });

  it("rejects PNG magic when the declared type is JPEG (R1 / AC1)", () => {
    expect(validateImageBuffer(PNG_BYTES, "image/jpeg")).toBeNull();
  });

  it("rejects unknown content types like image/heic (R1 / AC2)", () => {
    expect(validateImageBuffer(PNG_BYTES, "image/heic")).toBeNull();
  });

  it("rejects image/svg+xml — SVG is intentionally excluded", () => {
    const svgBytes = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>");
    expect(validateImageBuffer(svgBytes, "image/svg+xml")).toBeNull();
  });

  it("rejects WebP when the RIFF container is not followed by WEBP at offset 8", () => {
    const fakeWebp = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([0x10, 0x00, 0x00, 0x00]),
      Buffer.from("WAVE"),
    ]);
    expect(validateImageBuffer(fakeWebp, "image/webp")).toBeNull();
  });
});

describe("downloadProductImage", () => {
  let tempImagesDir: string;
  let savedImagesDir: string | undefined;

  beforeEach(() => {
    tempImagesDir = mkdtempSync(path.join(tmpdir(), "extract-image-test-"));
    savedImagesDir = process.env.IMAGES_DIR;
    // Use an absolute path so the test does not depend on cwd.
    process.env.IMAGES_DIR = tempImagesDir;
    resetEnvCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.IMAGES_DIR = savedImagesDir ?? ORIGINAL_IMAGES_DIR;
    resetEnvCache();
    rmSync(tempImagesDir, { recursive: true, force: true });
  });

  it("downloads a valid PNG and writes {productId}.png to IMAGES_DIR", async () => {
    const { calls } = fakeFetchResponses([
      () => sidecarJsonOk("image/png", PNG_BYTES.toString("base64")),
    ]);

    const filename = await downloadProductImage(
      "prod-png",
      "https://example.test/img.png",
    );

    expect(filename).toBe("prod-png.png");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toMatch(/\/v1\/fetch-image$/);
    const onDisk = readFileSync(path.join(tempImagesDir, "prod-png.png"));
    expect(onDisk.equals(PNG_BYTES)).toBe(true);
  });

  it("returns null and writes nothing when the declared MIME is SVG (AC5)", async () => {
    const { calls } = fakeFetchResponses([
      () => sidecarJsonOk("image/svg+xml", "<svg/>".toString("base64")),
    ]);

    const filename = await downloadProductImage(
      "prod-svg",
      "https://example.test/img.svg",
    );

    expect(filename).toBeNull();
    expect(calls).toHaveLength(1);
    // No file on disk — the sidecar response was rejected.
    expect(() => readFileSync(path.join(tempImagesDir, "prod-svg.svg"))).toThrow();
  });

  it("returns null and writes nothing when the sidecar reports image/heic (AC2)", async () => {
    fakeFetchResponses([
      () => sidecarJsonOk("image/heic", PNG_BYTES.toString("base64")),
    ]);

    const filename = await downloadProductImage(
      "prod-heic",
      "https://example.test/img.heic",
    );

    expect(filename).toBeNull();
    expect(() => readFileSync(path.join(tempImagesDir, "prod-heic.jpg"))).toThrow();
  });

  it("rejects when magic bytes do not match the declared MIME (AC1)", async () => {
    // Claim JPEG; deliver PNG bytes.
    fakeFetchResponses([
      () => sidecarJsonOk("image/jpeg", PNG_BYTES.toString("base64")),
    ]);

    const filename = await downloadProductImage(
      "prod-mismatch",
      "https://example.test/img.jpg",
    );

    expect(filename).toBeNull();
    expect(() => readFileSync(path.join(tempImagesDir, "prod-mismatch.jpg"))).toThrow();
  });

  it("retries a transient 502 once, then succeeds on attempt 2 (AC3)", async () => {
    const { calls } = fakeFetchResponses([
      () => sidecarHttpError(502),
      () => sidecarJsonOk("image/png", PNG_BYTES.toString("base64")),
    ]);

    const filename = await downloadProductImage(
      "prod-retry",
      "https://example.test/img.png",
    );

    expect(filename).toBe("prod-retry.png");
    expect(calls).toHaveLength(2);
    const onDisk = readFileSync(path.join(tempImagesDir, "prod-retry.png"));
    expect(onDisk.equals(PNG_BYTES)).toBe(true);
  }, 8_000);

  it("returns null after exhausting the 2-attempt budget on persistent 5xx (AC3)", async () => {
    const { calls } = fakeFetchResponses([
      () => sidecarHttpError(502),
      () => sidecarHttpError(502),
    ]);

    const filename = await downloadProductImage(
      "prod-fail",
      "https://example.test/img.png",
    );

    expect(filename).toBeNull();
    expect(calls).toHaveLength(2);
  }, 8_000);

  it("bounds concurrent downloads to IMAGE_DOWNLOAD_CONCURRENCY (3) (AC4)", async () => {
    let current = 0;
    let peak = 0;

    const spy = vi.fn(async () => {
      current += 1;
      peak = Math.max(peak, current);
      await new Promise((r) => setTimeout(r, 80));
      current -= 1;
      return sidecarJsonOk("image/png", PNG_BYTES.toString("base64"));
    });
    vi.stubGlobal("fetch", spy);

    const productIds = Array.from({ length: 20 }, (_, i) => `prod-${i}`);
    const results = await Promise.all(
      productIds.map((id) => downloadProductImage(id, `https://example.test/${id}`)),
    );

    // Every result should be a non-null filename ending in .png.
    for (const r of results) {
      expect(r).toMatch(/^prod-\d+\.png$/);
    }
    // At no point should more than 3 be in flight (matches IMAGE_DOWNLOAD_CONCURRENCY = 3).
    expect(peak).toBeLessThanOrEqual(3);
    expect(spy).toHaveBeenCalledTimes(20);
  }, 12_000);

  it("does not retry on a non-retryable 4xx", async () => {
    const { calls } = fakeFetchResponses([
      () => sidecarHttpError(400),
    ]);

    const filename = await downloadProductImage(
      "prod-400",
      "https://example.test/img.png",
    );

    expect(filename).toBeNull();
    expect(calls).toHaveLength(1);
  }, 8_000);

  it("does not retry on a sidecar-side rejection ({ ok: false })", async () => {
    const { calls } = fakeFetchResponses([
      () => sidecarJsonFail("unreachable"),
    ]);

    const filename = await downloadProductImage(
      "prod-sidecar-fail",
      "https://example.test/img.png",
    );

    expect(filename).toBeNull();
    expect(calls).toHaveLength(1);
  }, 8_000);
});
