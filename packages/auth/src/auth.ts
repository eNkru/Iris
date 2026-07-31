import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { db } from "@iris/database";
import { getEnv } from "@iris/utils";
import { bootstrapFirstUserAsAdmin } from "./lib/bootstrap-admin";
import { sendMagicLinkEmail } from "./lib/smtp";

/**
 * better-auth configuration (authentication.md).
 *
 * - Magic-link (passwordless) email login only; OAuth is out of scope for the
 *   LAN-only deployment (R1).
 * - `user.additionalFields.role` backs R2 (first user becomes admin) and the
 *   `adminProcedure` role check; it is not settable from the client.
 * - SMTP transport is configured for sending login links; the same transport
 *   will later power the email alert channel (R12).
 */
export const auth = betterAuth({
  appName: "Iris",
  baseURL: getEnv().APP_URL,
  secret: getEnv().BETTER_AUTH_SECRET,

  database: drizzleAdapter(db, { provider: "pg" }),

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    freshAge: 0,
  },

  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false,
      },
    },
  },

  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail({ email, url });
      },
    }),
  ],

  databaseHooks: {
    user: {
      create: {
        after: async (userRecord) => {
          await bootstrapFirstUserAsAdmin(userRecord.id);
        },
      },
    },
  },
});

/**
 * Inferred session shape: `{ session, user }` including the `role` additional
 * field. The API layer uses this for the protected/admin procedure context.
 */
export type Session = typeof auth.$Infer.Session;
