import { os } from "@orpc/server";

function generateLogId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

function getOrGenerateLogId(headers: Headers): string {
  // Prefer a client-provided x-log-id for distributed tracing.
  const existingLogId = headers.get("x-log-id");
  if (existingLogId) {
    return existingLogId;
  }
  return generateLogId();
}

/**
 * Generates (or propagates) a request id and makes it available in the
 * procedure context for structured logging (logging.md).
 */
export const logIdMiddleware = os
  .$context<{ headers: Headers }>()
  .middleware(async ({ context, next }) => {
    const logId = getOrGenerateLogId(context.headers);

    return await next({
      context: { logId },
    });
  });
