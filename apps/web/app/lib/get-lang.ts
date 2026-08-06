import { cookies } from "next/headers";
import { LANG_COOKIE_NAME, type Lang } from "../../lib/dictionary";

/**
 * Resolve the current UI language for server components from the `iris.lang`
 * cookie (kept in sync by the client LanguageProvider, see lib/i18n.tsx).
 * Defaults to English when the cookie is missing or invalid.
 */
export async function getLang(): Promise<Lang> {
  const value = (await cookies()).get(LANG_COOKIE_NAME)?.value;
  return value === "zh" ? "zh" : "en";
}