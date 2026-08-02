import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Server-side route protection (frontend/authentication.md §4).
 *
 * Every page except /login requires a session cookie; unauthenticated visitors
 * are redirected to /login with the original path preserved. /login redirects
 * authenticated users to the home page.
 */
export default function middleware(req: NextRequest) {
  const { pathname, origin } = req.nextUrl;
  const sessionCookie = getSessionCookie(req);

  if (!sessionCookie && pathname !== "/login") {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (sessionCookie && pathname === "/login") {
    return NextResponse.redirect(new URL("/", origin));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
