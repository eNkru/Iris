import { z } from "zod";

export const healthCheckOutputSchema = z.object({
  success: z.literal(true),
  reason: z.string(),
  status: z.literal("ok"),
});

export type HealthCheckOutput = z.infer<typeof healthCheckOutputSchema>;
