import { ORPCError } from "@orpc/server";
import { sendProductSummary } from "@iris/prices/notifications";
import { protectedProcedure } from "../../../orpc/procedures";
import { sendSummaryOutputSchema } from "../types";

/**
 * Send a summary of the user's tracked products to their enabled Telegram
 * channel(s) (design.md — "Send summary to Telegram").
 *
 * Fails with PRECONDITION_FAILED when no enabled Telegram channel is
 * configured, so the UI can direct the user to Settings → Alert channels.
 */
export const sendSummary = protectedProcedure
  .route({
    method: "POST",
    path: "/channels/summary",
    tags: ["Channels"],
    summary: "Send a product summary to the user's Telegram channel",
  })
  .output(sendSummaryOutputSchema)
  .handler(async ({ context }) => {
    const result = await sendProductSummary(context.user.id);

    if (result.total === 0) {
      throw new ORPCError("PRECONDITION_FAILED", {
        message:
          "No enabled Telegram channel — add and enable one in Settings → Alert channels",
      });
    }

    return {
      success: true as const,
      reason: result.sent > 0 ? "Summary sent" : "No channel received the summary",
      sent: result.sent,
      total: result.total,
      productsCount: result.productsCount,
    };
  });