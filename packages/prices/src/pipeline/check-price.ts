import { eq } from "drizzle-orm";
import { db } from "@iris/database";
import { priceReadings, products } from "@iris/database/drizzle/schema/sqlite";
import { getGlobalSettings } from "@iris/database/drizzle/queries";
import { logger } from "@iris/utils";
import { dispatchPriceAlert } from "../notifications/dispatch";
import { roundToCent, shouldAlert } from "./alert-rules";
import { resolveAiConfig, aiExtractPrice } from "./ai-extract";
import { fetchPage } from "./fetch-page";
import { extractProductImageUrl, downloadProductImage } from "./extract-image";
import type { CheckPriceResult } from "./types";

type ProductRow = typeof products.$inferSelect;

const inflightChecks = new Map<string, Promise<CheckPriceResult>>();

/**
 * checkPrice(productId) — the synchronous price-check pipeline (R8):
 * visit page → AI extract price → store → compare with last price → alert if
 * changed. Called by both the synchronous RPC (create/checkNow) and the
 * scheduler.
 *
 * ## Transactionality
 *
 * Network/AI calls (fetch + generateText) run OUTSIDE any database
 * transaction so a slow page or model does not hold a connection. The
 * read-modify-write — load the product row, insert a `price_readings` row when
 * the price changed, update `currentPrice`/`lastCheckedAt` — runs inside a
 * single transaction. Concurrent checks of the same product (scheduler tick +
 * manual check-now) are coalesced by the module-level single-flight mutex, so
 * only one fetch/extraction/write pipeline runs for a product at a time.
 */
export function checkPrice(productId: string): Promise<CheckPriceResult> {
  const existing = inflightChecks.get(productId);
  if (existing) {
    return existing;
  }

  const pending = runCheckPrice(productId);
  inflightChecks.set(productId, pending);
  const cleanup = (): void => {
    inflightChecks.delete(productId);
  };
  void pending.then(cleanup, cleanup);
  return pending;
}

async function runCheckPrice(productId: string): Promise<CheckPriceResult> {
  const now = new Date();

  const product = await getProductForCheck(productId);
  if (!product) {
    return { status: "not_found" };
  }

  // --- Network / AI (outside any DB transaction) ---
  const page = await fetchPage(product.url, { productId });
  if (!page) {
    // `null` = transport failed after retries (sidecar down, network error,
    // non-JSON). This is the generic transport failure, not an anti-bot block.
    await touchLastCheckedAt(productId, now);
    return { status: "failed", reason: "Page fetch failed" };
  }

  // Anti-bot challenge / deny page (e.g. Akamai `/WAF_Deny_Page/`, DataDome
  // captcha, Cloudflare "Just a moment…"): short-circuit before the AI call —
  // the page carries no price, so extraction would waste a model call and mask
  // the block as "unavailable". Surfacing the clear reason lets the operator
  // distinguish anti-bot from genuine stock-out (AC3).
  if (page.kind === "blocked") {
    await touchLastCheckedAt(productId, now);
    logger.warn("Page blocked by anti-bot WAF", {
      productId,
      url: product.url,
      signature: page.signature,
    });
    return {
      status: "failed",
      reason: `Anti-bot WAF deny page (${page.signature}) — retailer blocks automated access.`,
    };
  }

  const settings = await getGlobalSettings();
  const config = resolveAiConfig(settings);
  // Pass the already-fetched HTML so extraction is a single generateText call
  // (no multi-step tool loop). That avoids a DeepSeek thinking-mode failure
  // where step 2 drops `reasoning_content` (ai-sdk-integration.md §1e) and
  // skips a redundant second Camoufox fetch of the same URL.
  const extraction = config
    ? await aiExtractPrice({ url: page.url, productId, config, html: page.html })
    : null;

  if (!extraction) {
    await touchLastCheckedAt(productId, now);
    return { status: "failed", reason: "Price extraction failed" };
  }

  if (!extraction.available) {
    // Out of stock / no visible price — record nothing, just mark checked.
    await touchLastCheckedAt(productId, now);
    logger.info("Product reported unavailable by extraction", { productId });
    return { status: "unavailable" };
  }

  // --- Image capture (best-effort, outside the DB transaction) ---
  // Only capture when the product doesn't already have an image, so
  // routine re-checks don't re-download the same image on every tick.
  let imageFilename: string | null = null;
  if (!product.imagePath) {
    const imageUrl = extractProductImageUrl(page.html, page.url);
    if (imageUrl) {
      logger.info("Attempting product image download", {
        productId,
        imageUrl,
      });
      imageFilename = await downloadProductImage(productId, imageUrl);
      if (!imageFilename) {
        logger.warn("Product image download returned null", {
          productId,
          imageUrl,
        });
      }
    } else {
      logger.warn("No product image URL found in page HTML", {
        productId,
        url: product.url,
      });
    }
  }

  // --- Transactional read-modify-write ---
  const outcome = db.transaction((tx) => {
    const locked = tx
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .get();

    if (!locked) {
      return { kind: "not_found" as const };
    }

    const oldPrice = locked.currentPrice !== null ? Number(locked.currentPrice) : null;
    const newPrice = extraction.price;
    const changed = oldPrice === null || roundToCent(oldPrice) !== roundToCent(newPrice);

    if (!changed) {
      tx
        .update(products)
        .set({
          lastCheckedAt: now,
          updatedAt: now,
          ...(imageFilename ? { imagePath: imageFilename } : {}),
        })
        .where(eq(products.id, productId))
        .run();

      return { kind: "unchanged" as const, price: newPrice, product: locked };
    }

    // Insert history only on price change (R9); update the current price and
    // fill name/currency from the extraction when not yet known.
    tx.insert(priceReadings).values({
      productId,
      price: newPrice.toFixed(2),
      currency: extraction.currency,
      checkedAt: now,
    }).run();

    tx
      .update(products)
      .set({
        currentPrice: newPrice.toFixed(2),
        currency: extraction.currency,
        name: locked.name ?? extraction.name ?? null,
        lastCheckedAt: now,
        updatedAt: now,
        ...(imageFilename ? { imagePath: imageFilename } : {}),
      })
      .where(eq(products.id, productId))
      .run();

    return {
      kind: "changed" as const,
      oldPrice,
      newPrice,
      currency: extraction.currency,
      product: locked,
    };
  });

  if (outcome.kind === "not_found") {
    return { status: "not_found" };
  }

  if (outcome.kind === "unchanged") {
    return { status: "unchanged", price: outcome.price };
  }

  // --- Changed: evaluate alert rules and dispatch (R10/R11) ---
  let alertDispatched = false;

  if (outcome.oldPrice !== null) {
    const evaluation = shouldAlert(
      outcome.oldPrice,
      outcome.newPrice,
      outcome.product.alertRules,
    );

    if (evaluation.shouldAlert) {
      const dispatchResult = await dispatchPriceAlert({
        productId,
        userId: outcome.product.userId,
        productName: outcome.product.name ?? extraction.name ?? null,
        productUrl: outcome.product.url,
        currency: outcome.currency,
        oldPrice: outcome.oldPrice,
        newPrice: outcome.newPrice,
        direction: evaluation.direction,
      });
      alertDispatched = dispatchResult.sent > 0;
    }
  }

  logger.info("Product price changed", {
    productId,
    oldPrice: outcome.oldPrice,
    newPrice: outcome.newPrice,
    currency: outcome.currency,
    alertDispatched,
  });

  return {
    status: "changed",
    oldPrice: outcome.oldPrice,
    newPrice: outcome.newPrice,
    currency: outcome.currency,
    alertDispatched,
  };
}

async function getProductForCheck(productId: string): Promise<ProductRow | null> {
  const [row] = await db.select().from(products).where(eq(products.id, productId));
  return row ?? null;
}

/**
 * Record that a check happened without a price change / without a successful
 * extraction, so the scheduler does not immediately re-check the product.
 */
async function touchLastCheckedAt(productId: string, at: Date): Promise<void> {
  await db
    .update(products)
    .set({ lastCheckedAt: at, updatedAt: at })
    .where(eq(products.id, productId));
}
