import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@iris/auth";

/**
 * better-auth HTTP handler (magic-link sign-in/verify, session, sign-out).
 */
export const { GET, POST } = toNextJsHandler(auth);
