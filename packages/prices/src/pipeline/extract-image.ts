import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import pLimit from "p-limit";
import { getEnv, logger } from "@iris/utils";
import { retryWithBackoff } from "./retry";

/**
 * Accepted image content types and their on-disk extension. Each entry pairs
 * the canonical MIME with the magic-byte prefix used to validate that the
 * returned bytes actually match the declared content type (R1). Anything
 * outside this set returns `null` from the validator and is skipped — no
 * silent fallback to `.jpg` (R1 acceptance criterion).
 *
 * SVG is intentionally NOT in the table. SVG can carry inline scripts and the
 * image serve endpoint returns the saved bytes with the same origin in the
 * authenticated user's DOM — a direct XSS vector when the retailer authors
 * a malicious `og:image`. The cost (no SVG logos as product imagery) is far
 * lower than the security review surface DOMPurify would add.
 */
interface ContentTypeDescriptor {
  ext: string;
  /** Magic-byte prefix (length 4–12). The validator compares against this. */
  magic: Buffer;
  /**
   * Optional exact-match check for the few formats whose header is shorter
   * than the structure (GIF, WebP). When defined the validator reads the
   * bytes at this offset and requires an exact equality — e.g. "WEBP" at
   * offset 8 for RIFF/WebP, "87a"/"89a" for GIF87a/GIF89a. The
   * `expected` field is an array so a single rule can accept multiple
   * alternatives (e.g. GIF's two version stamps) without duplicating the
   * entry.
   */
  continuation?: { offset: number; expected: Buffer[] }[];
}

const CONTENT_TYPE_EXTENSIONS: Record<string, ContentTypeDescriptor> = {
  "image/jpeg": {
    ext: ".jpg",
    magic: Buffer.from([0xff, 0xd8, 0xff]),
  },
  "image/png": {
    ext: ".png",
    magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  "image/gif": {
    ext: ".gif",
    // GIF87a / GIF89a — the magic prefix is the first three bytes "GIF".
    magic: Buffer.from("GIF"),
    continuation: [
      { offset: 3, expected: [Buffer.from("87a"), Buffer.from("89a")] },
    ],
  },
  "image/webp": {
    ext: ".webp",
    // RIFF container — the "WEBP" fourcc lives at offset 8.
    magic: Buffer.from("RIFF"),
    continuation: [{ offset: 8, expected: [Buffer.from("WEBP")] }],
  },
  "image/avif": {
    ext: ".avif",
    // ISOBMFF / ftyp box. The first 4 bytes are the box size, bytes 4–7 are
    // "ftyp". We require that prefix.
    magic: Buffer.from([0x00, 0x00, 0x00]),
    continuation: [{ offset: 4, expected: [Buffer.from("ftyp")] }],
  },
};

const DOWNLOAD_TIMEOUT_MS = 45_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_DOWNLOAD_CONCURRENCY = 3;
const IMAGE_RETRY_MAX = 2;
const IMAGE_RETRY_BASE_MS = 1_000;
const IMAGE_RETRY_MAX_MS = 10_000;
const IMAGE_RETRY_JITTER = 0.5;

/** Module-wide limiter: all image downloads share this concurrency budget. */
const imageDownloadLimiter = pLimit(IMAGE_DOWNLOAD_CONCURRENCY);

function splitContentType(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * Validate that the buffer's magic bytes match the declared MIME. Returns the
 * verified `{ ext }` on success, or `null` when the type is unknown or the
 * bytes don't match. The caller maps `null` to a warning log and a download
 * skip (R1).
 */
export function validateImageBuffer(
  buffer: Buffer,
  contentType: string,
): { ext: string; contentType: string } | null {
  const mime = splitContentType(contentType);
  const descriptor = CONTENT_TYPE_EXTENSIONS[mime];
  if (!descriptor) {
    return null;
  }
  if (buffer.length < descriptor.magic.length) {
    return null;
  }
  if (!buffer.subarray(0, descriptor.magic.length).equals(descriptor.magic)) {
    return null;
  }
  if (descriptor.continuation) {
    for (const check of descriptor.continuation) {
      const alt = check.expected.find((e) => {
        const end = check.offset + e.length;
        if (buffer.length < end) return false;
        return buffer.subarray(check.offset, end).equals(e);
      });
      if (!alt) return null;
    }
  }
  return { ext: descriptor.ext, contentType: mime };
}

/**
 * Extract the best product image URL from the raw page HTML. Tries, in order
 * of reliability:
 * 1. OpenGraph `og:image` meta tag (most e-commerce sites set this)
 * 2. Twitter `twitter:image` meta tag
 * 3. JSON-LD `@type: "Product"` structured data `image` field
 *
 * Returns an absolute URL (resolved against `baseUrl` if the source uses a
 * relative path), or `null` when no image is found.
 */
export function extractProductImageUrl(
  html: string,
  baseUrl: string,
): string | null {
  const ogImage = matchMetaTag(html, "og:image");
  if (ogImage) {
    return resolveUrl(ogImage, baseUrl);
  }

  const twitterImage = matchMetaTag(html, "twitter:image");
  if (twitterImage) {
    return resolveUrl(twitterImage, baseUrl);
  }

  const jsonLdImage = matchJsonLdImage(html);
  if (jsonLdImage) {
    return resolveUrl(jsonLdImage, baseUrl);
  }

  return null;
}

function matchMetaTag(html: string, property: string): string | null {
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${property}["']`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function matchJsonLdImage(html: string): string | null {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1])
    .filter((s): s is string => s !== undefined);

  for (const script of scripts) {
    try {
      const data = JSON.parse(script.trim());
      const candidates = Array.isArray(data) ? data : [data];
      for (const item of candidates) {
        const type = item?.["@type"];
        const isProduct =
          type === "Product" ||
          (Array.isArray(type) && type.includes("Product"));
        if (!isProduct) continue;
        const image = item?.image;
        if (typeof image === "string") return image;
        if (Array.isArray(image) && image.length > 0 && typeof image[0] === "string") {
          return image[0];
        }
        if (image?.url && typeof image.url === "string") return image.url;
      }
    } catch {
      // Malformed JSON-LD — skip
    }
  }
  return null;
}

function resolveUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

function getImagesDir(): string {
  return getEnv().IMAGES_DIR;
}

/**
 * Body shape of a successful sidecar image fetch response.
 */
interface SidecarImageOkResponse {
  ok: true;
  contentType: string;
  data: string;
}

/**
 * Body shape of a sidecar image fetch failure response (the sidecar never throws).
 */
interface SidecarImageFailResponse {
  ok: false;
  reason: string;
}

/**
 * Single-attempt outcome of an image fetch. Throws only on a transport error
 * (network, non-JSON body, schema mismatch, non-2xx status); classification of
 * the error (retryable 5xx vs. terminal 4xx vs. payload shape mismatch) is
 * owned by the caller in `shouldRetry`.
 */
type ImageFetchAttempt =
  | { kind: "ok"; contentType: string; data: string }
  | { kind: "sidecar_rejected"; reason: string };

async function attemptSidecarImageFetch(
  imageUrl: string,
): Promise<ImageFetchAttempt> {
  const { CAMOUFOX_SIDECAR_URL } = getEnv();
  const endpoint = `${CAMOUFOX_SIDECAR_URL.replace(/\/+$/, "")}/v1/fetch-image`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: imageUrl }),
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new SidecarImageHttpError(response.status, response.statusText);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SidecarImageSchemaMismatchError("non-JSON body");
  }

  if (payload && typeof payload === "object" && (payload as { ok?: unknown }).ok === true) {
    const ok = payload as SidecarImageOkResponse;
    if (
      typeof ok.contentType === "string" &&
      typeof ok.data === "string"
    ) {
      return { kind: "ok", contentType: ok.contentType, data: ok.data };
    }
    throw new SidecarImageSchemaMismatchError("missing contentType or data");
  }

  if (payload && typeof payload === "object" && (payload as { ok?: unknown }).ok === false) {
    const fail = payload as SidecarImageFailResponse;
    const reason = typeof fail.reason === "string" ? fail.reason : "unknown";
    return { kind: "sidecar_rejected", reason };
  }

  throw new SidecarImageSchemaMismatchError("unexpected payload shape");
}

/**
 * Thrown by `attemptSidecarImageFetch` for HTTP / network / schema failures.
 * Tagged with `retryable` so the retry helper can branch — schema mismatches
 * are terminal because retrying will not change the sidecar's response shape.
 */
class SidecarImageHttpError extends Error {
  readonly status: number;
  constructor(status: number, statusText: string) {
    super(`sidecar HTTP ${status} ${statusText}`);
    this.name = "SidecarImageHttpError";
    this.status = status;
  }
  get retryable(): boolean {
    // 5xx (transient) and 408/429 (timeouts / rate-limit) retry. Other 4xx
    // and the rare 1xx/3xx are terminal.
    return this.status >= 500 || this.status === 408 || this.status === 429;
  }
}

class SidecarImageSchemaMismatchError extends Error {
  readonly retryable = false;
  constructor(reason: string) {
    super(`sidecar schema mismatch: ${reason}`);
    this.name = "SidecarImageSchemaMismatchError";
  }
}

/**
 * Decide whether an image-fetch error should be retried. Throws on schema
 * mismatches and non-retryable HTTP statuses; transient 5xx, network
 * failures (`TypeError` from `fetch`, `AbortError`, `TimeoutError`) retry
 * with exponential backoff and jitter.
 */
function shouldRetryImageError(
  error: unknown,
  ctx: { attempt: number; maxRetries: number },
): { retry: boolean } {
  if (error instanceof SidecarImageHttpError) {
    return { retry: error.retryable && ctx.attempt < ctx.maxRetries };
  }
  if (error instanceof SidecarImageSchemaMismatchError) {
    return { retry: false };
  }
  if (error instanceof Error) {
    // Network errors (`fetch` throws `TypeError`), aborts, timeouts — all
    // transient from our side.
    if (
      error.name === "AbortError" ||
      error.name === "TimeoutError" ||
      error.name === "TypeError"
    ) {
      return { retry: ctx.attempt < ctx.maxRetries };
    }
  }
  return { retry: false };
}

/**
 * Download a product image and save it to the local `IMAGES_DIR`. The filename
 * is `{productId}.{ext}`, where the extension is derived from the response
 * `Content-Type` header.
 *
 * Routes the download through the Camoufox sidecar (`POST /v1/fetch-image`)
 * — the same anti-detect browser that fetches page HTML. Retailers behind
 * Cloudflare or other anti-bot WAFs (e.g. pbtech.co.nz) 403 a plain Node.js
 * `fetch` on image CDN URLs; the browser request carries the full TLS
 * fingerprint and passes the WAF.
 *
 * Hardened against four classes of failure (PRD §08-16):
 *   R1. The downloaded buffer is validated against the declared content type
 *       via magic-byte inspection. Unknown / unsupported types (including
 *       SVG) return `null` and a warning log — no silent fallback to `.jpg`.
 *   R2. Transient sidecar failures (5xx, network, AbortError, TimeoutError)
 *       are retried with exponential backoff and jitter.
 *   R3. All downloads share a module-level `pLimit(IMAGE_DOWNLOAD_CONCURRENCY)`
 *       budget (currently 3) so a burst of first-time products does not
 *       spike sidecar / app memory.
 *   R4. SVG is rejected at the download boundary because the serve endpoint
 *       streams saved bytes into the authenticated user's DOM with the
 *       same origin — a direct XSS vector.
 *
 * Returns the filename on success, or `null` on any failure. Never throws —
 * image capture is best-effort and must not fail the pipeline.
 */
export async function downloadProductImage(
  productId: string,
  imageUrl: string,
): Promise<string | null> {
  return imageDownloadLimiter(async () => {
    try {
      const { payload, filename } = await retryWithBackoff(
        async () => {
          const attempt = await attemptSidecarImageFetch(imageUrl);
          if (attempt.kind === "sidecar_rejected") {
            logger.warn("Product image download rejected (sidecar)", {
              productId,
              imageUrl,
              reason: attempt.reason,
            });
            return { payload: null, filename: null } as const;
          }
          const { contentType, data } = attempt;
          const buffer = Buffer.from(data, "base64");

          if (buffer.byteLength > MAX_IMAGE_BYTES) {
            logger.warn("Product image too large, skipping", {
              productId,
              imageUrl,
              bytes: buffer.byteLength,
            });
            return { payload: null, filename: null } as const;
          }

          const validated = validateImageBuffer(buffer, contentType);
          if (!validated) {
            logger.warn("Product image validation failed", {
              productId,
              imageUrl,
              contentType,
              bytes: buffer.byteLength,
            });
            return { payload: null, filename: null } as const;
          }

          const newFilename = `${productId}${validated.ext}`;
          return {
            payload: { buffer, filename: newFilename },
            filename: newFilename,
          } as const;
        },
        {
          maxRetries: IMAGE_RETRY_MAX,
          baseMs: IMAGE_RETRY_BASE_MS,
          maxMs: IMAGE_RETRY_MAX_MS,
          jitter: IMAGE_RETRY_JITTER,
          shouldRetry: shouldRetryImageError,
          onRetry: (error, attempt, delayMs) => {
            logger.warn("Product image sidecar error, retrying", {
              productId,
              imageUrl,
              attempt,
              delayMs: Math.round(delayMs),
              error: error instanceof Error ? error.message : String(error),
            });
          },
        },
      );

      if (!payload) {
        return null;
      }

      const imagesDir = getImagesDir();
      mkdirSync(imagesDir, { recursive: true });
      writeFileSync(path.join(imagesDir, filename), payload.buffer);

      logger.info("Product image downloaded", {
        productId,
        imageUrl,
        filename,
        bytes: payload.buffer.byteLength,
      });

      return filename;
    } catch (error) {
      logger.warn("Product image download failed after retries", {
        productId,
        imageUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  });
}
