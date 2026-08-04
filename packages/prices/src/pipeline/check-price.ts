import { eq } from "drizzle-orm";
import { db } from "@iris/database";
import { priceReadings, products } from "@iris/database/drizzle/schema/postgres";
import { getGlobalSettings } from "@iris/database/drizzle/queries";
import { logger } from "@iris/utils";
import { dispatchPriceAlert } from "../notifications/dispatch";
import { roundToCent, shouldAlert } from "./alert-rules";
import { resolveAiConfig, aiExtractPrice } from "./ai-extract";
import { detectBlockedPage } from "./blocked-signatures";
import { fetchPage } from "./fetch-page";
import type { CheckPriceResult } from "./types";

type ProductRow = typeof products.$inferSelect;

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
 * single transaction using `SELECT ... FOR UPDATE` on the product row.
 * Concurrent checks of the same product (scheduler tick + manual check-now)
 * therefore serialize on the row lock: the second writer re-reads the row
 * inside the transaction, sees the price already recorded, and only refreshes
 * `lastCheckedAt` — no duplicate readings, no lost updates.
 */
export async function checkPrice(productId: string): Promise<CheckPriceResult> {
  const now = new Date();

  const product = await getProductForCheck(productId);
  if (!product) {
    return { status: "not_found" };
  }

  // --- Network / AI (outside any DB transaction) ---
  const page = await fetchPage(product.url, { productId });
  if (!page) {
    await touchLastCheckedAt(productId, now);
    return { status: "failed", reason: "Page fetch failed" };
  }

  // Anti-bot WAF deny page (e.g. Akamai `/WAF_Deny_Page/`): short-circuit
  // before the AI call — the page carries no price, so extraction would waste
  // a model call and mask the block as "unavailable". Surfacing the clear
  // reason lets the operator distinguish anti-bot from genuine stock-out.
  const blocked = detectBlockedPage(page.html);
  if (blocked) {
    await touchLastCheckedAt(productId, now);
    logger.warn("Page blocked by anti-bot WAF", {
      productId,
      url: product.url,
      signature: blocked,
    });
    return {
      status: "failed",
      reason: `Anti-bot WAF deny page (${blocked}) — retailer blocks automated access.`,
    };
  }

  const settings = await getGlobalSettings();
  const config = resolveAiConfig(settings);
  const extraction = config
    ? await aiExtractPrice({ url: page.url, productId, config })
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

  // --- Transactional read-modify-write ---
  const outcome = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .for("update");

    if (!locked) {
      return { kind: "not_found" as const };
    }

    const oldPrice = locked.currentPrice !== null ? Number(locked.currentPrice) : null;
    const newPrice = extraction.price;
    const changed = oldPrice === null || roundToCent(oldPrice) !== roundToCent(newPrice);

    if (!changed) {
      await tx
        .update(products)
        .set({ lastCheckedAt: now, updatedAt: now })
        .where(eq(products.id, productId));

      return { kind: "unchanged" as const, price: newPrice, product: locked };
    }

    // Insert history only on price change (R9); update the current price and
    // fill name/currency from the extraction when not yet known.
    await tx.insert(priceReadings).values({
      productId,
      price: newPrice.toFixed(2),
      currency: extraction.currency,
      checkedAt: now,
    });

    await tx
      .update(products)
      .set({
        currentPrice: newPrice.toFixed(2),
        currency: extraction.currency,
        name: locked.name ?? extraction.name ?? null,
        lastCheckedAt: now,
        updatedAt: now,
      })
      .where(eq(products.id, productId));

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
