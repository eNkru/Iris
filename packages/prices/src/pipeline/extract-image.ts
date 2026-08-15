import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getEnv, logger } from "@iris/utils";

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

const DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

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

function getExtensionFromContentType(contentType: string): string {
  const parts = contentType.split(";");
  const ct = (parts[0] ?? "").trim().toLowerCase();
  return CONTENT_TYPE_EXTENSIONS[ct] ?? ".jpg";
}

function getImagesDir(): string {
  return getEnv().IMAGES_DIR;
}

/**
 * Download a product image and save it to the local `IMAGES_DIR`. The filename
 * is `{productId}.{ext}`, where the extension is derived from the response
 * `Content-Type` header.
 *
 * Returns the filename on success, or `null` on any failure. Never throws —
 * image capture is best-effort and must not fail the pipeline.
 */
export async function downloadProductImage(
  productId: string,
  imageUrl: string,
): Promise<string | null> {
  try {
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: { "user-agent": "Mozilla/5.0 (compatible; Iris/1.0)" },
    });

    if (!response.ok) {
      logger.warn("Product image download failed (non-2xx)", {
        productId,
        imageUrl,
        status: response.status,
      });
      return null;
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_IMAGE_BYTES) {
      logger.warn("Product image too large, skipping", {
        productId,
        imageUrl,
        contentLength,
      });
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const ext = getExtensionFromContentType(contentType);
    const filename = `${productId}${ext}`;

    const buffer = await response.arrayBuffer();

    const imagesDir = getImagesDir();
    mkdirSync(imagesDir, { recursive: true });
    writeFileSync(path.join(imagesDir, filename), Buffer.from(buffer));

    logger.info("Product image downloaded", {
      productId,
      imageUrl,
      filename,
      bytes: buffer.byteLength,
    });

    return filename;
  } catch (error) {
    logger.warn("Product image download failed", {
      productId,
      imageUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
