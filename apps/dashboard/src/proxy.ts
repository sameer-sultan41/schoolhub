import { type NextRequest, NextResponse } from "next/server";
import { Paths } from "@/config/paths";
import { Cookies } from "@/lib/cookies";

/**
 * Auth guard. (Next 16 renamed the `middleware` convention to `proxy`.)
 *
 * This is a **routing** decision, not an authorization one: it checks only that a session
 * cookie exists so we can send an anonymous visitor to /login instead of flashing an empty
 * app shell. The cookie is opaque and HttpOnly — the proxy cannot and must not try to
 * read a user, roles, or permissions out of it. Every API call is authorized server-side.
 */

const PUBLIC_PATHS = [Paths.LOGIN, Paths.FORGOT_PASSWORD, Paths.RESET_PASSWORD];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const hasSession = request.cookies.has(Cookies.SESSION);

  // Signed in and heading for the sign-in page: send them where they meant to go.
  if (hasSession && isPublicPath(pathname)) {
    const nextParam = request.nextUrl.searchParams.get("next");
    const target = nextParam?.startsWith("/") ? nextParam : Paths.DASHBOARD;
    return NextResponse.redirect(new URL(target, request.url));
  }

  if (hasSession || isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const loginUrl = new URL(Paths.LOGIN, request.url);
  // Only ever round-trip a same-origin path, so this cannot become an open redirect.
  if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  /**
   * Everything except Next internals, API routes, and static assets. `/api/health` must
   * stay reachable for the platform's uptime checks, and `/api/auth/*` (rewritten to the
   * real API — see next.config.ts) carries the login/refresh/logout calls that establish
   * the session cookie this guard itself checks; gating it on that same cookie would make
   * login impossible.
   */
  matcher: ["/((?!_next/static|_next/image|api/|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
