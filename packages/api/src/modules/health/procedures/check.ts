import { publicProcedure } from "../../../orpc/procedures";
import { healthCheckOutputSchema } from "../types";

export const checkHealth = publicProcedure
  .route({
    method: "GET",
    path: "/health",
    tags: ["Health"],
    summary: "Service health check",
  })
  .output(healthCheckOutputSchema)
  .handler(async () => ({
    success: true,
    reason: "Service is healthy",
    status: "ok" as const,
  }));
