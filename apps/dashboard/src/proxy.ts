import { type NextRequest, NextResponse } from "next/server";
import { Paths } from "@/config/paths";
import { matchesPath } from "@/lib/active-path";
import { Cookies } from "@/lib/cookies";
import { env } from "@/lib/env";
import { parseTenantSlug } from "@/lib/host";
import { safeNextPath } from "@/lib/safe-next-path";

/**
 * Auth guard. (Next 16 renamed the `middleware` convention to `proxy`.)
 *
 * This is a **routing** decision, not an authorization one: it checks only that a session
 * cookie exists so we can send an anonymous visitor to /login instead of flashing an empty
 * app shell. The cookie is opaque and HttpOnly — the proxy cannot and must not try to
 * read a user, roles, or permissions out of it. Every API call is authorized server-side.
 */

/**
 * Pages an emailed link opens (ADR-0033). Public, and never redirected for a signed-in
 * visitor: the browser carries the fragment (`#school=…&token=…`) across a redirect, so
 * sending them to /dashboard would drop the link and leave its token in that URL.
 */
const LINK_PATHS = [Paths.ACCEPT_INVITE, Paths.RESET_PASSWORD];

/**
 * The second factor's pages, likewise public and never redirected: a challenged sign-in has no
 * session yet, and a first sign-in enrols while it holds a password-only one, which the rule
 * below would otherwise bounce back to the dashboard.
 */
const MFA_PATHS = [Paths.MFA];

const PUBLIC_PATHS = [Paths.LOGIN, Paths.FORGOT_PASSWORD, ...LINK_PATHS, ...MFA_PATHS];

function matches(paths: readonly string[], pathname: string): boolean {
  return paths.some((path) => matchesPath(path, pathname));
}

function isPublicPath(pathname: string): boolean {
  return matches(PUBLIC_PATHS, pathname);
}

/**
 * The platform console exists only on the bare app host (`app.<platform-domain>`): on a
 * school's host it is not found, for everyone, before any session check, so the answer reveals
 * nothing. UX only: the API 404s a school's token on `/platform/*` regardless (ADR-0036).
 */
function isConsoleOnSchoolHost(request: NextRequest): boolean {
  return (
    matchesPath(Paths.PLATFORM, request.nextUrl.pathname) &&
    parseTenantSlug(request.nextUrl.hostname, env.NEXT_PUBLIC_PLATFORM_DOMAIN) !== null
  );
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const hasSession = request.cookies.has(Cookies.SESSION);

  if (isConsoleOnSchoolHost(request)) {
    return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
  }

  if (matches([...LINK_PATHS, ...MFA_PATHS], pathname)) return NextResponse.next();

  // Signed in and heading for the sign-in page, or the bare root (which has no page of
  // its own — only /dashboard, /staff, /students, etc. do): send them where they meant
  // to go.
  if (hasSession && (isPublicPath(pathname) || pathname === "/")) {
    const nextParam = request.nextUrl.searchParams.get("next");
    const target = safeNextPath(nextParam) ?? Paths.DASHBOARD;
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
