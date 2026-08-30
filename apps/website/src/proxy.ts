import { type NextRequest, NextResponse } from "next/server";
import {
  TENANT_HOST_HEADER,
  TENANT_KIND_HEADER,
  TENANT_SLUG_HEADER,
  parseHost,
} from "@/lib/host";

/**
 * Resolves the tenant host on every request (website-builder.md §1).
 * (Next 16 renamed the `middleware` convention to `proxy`; the behaviour is unchanged.)
 *
 * The proxy performs the cheap, pure classification (wildcard subdomain vs custom
 * domain) and hands the result downstream as request headers. The authoritative lookup —
 * does this host belong to an active tenant? — happens in `lib/tenant.ts` against the API,
 * where the result can be cached.
 *
 * Security: inbound `x-schoolhub-*` headers are **deleted** before ours are set. Without
 * that, a client could hand us a header and read another school's site.
 */
export function proxy(request: NextRequest): NextResponse {
  const platformDomain = process.env.NEXT_PUBLIC_PLATFORM_DOMAIN ?? "";
  const resolved = parseHost(request.headers.get("host"), platformDomain);

  const headers = new Headers(request.headers);
  headers.delete(TENANT_HOST_HEADER);
  headers.delete(TENANT_SLUG_HEADER);
  headers.delete(TENANT_KIND_HEADER);

  if (!resolved) {
    // Unknown host → the platform landing page. Never fall back to another tenant.
    //
    // Not `/_platform`: Next.js treats an underscore-prefixed segment as a private
    // folder, excluded from routing entirely — a rewrite to it 404s, silently, because
    // the route does not exist. Confirmed against the build's own route manifest, which
    // never lists it. `/platform-landing` is a normal route.
    if (request.nextUrl.pathname === "/platform-landing") return NextResponse.next();
    return NextResponse.rewrite(new URL("/platform-landing", request.url));
  }

  headers.set(TENANT_HOST_HEADER, resolved.host);
  headers.set(TENANT_KIND_HEADER, resolved.kind);
  if (resolved.slug) headers.set(TENANT_SLUG_HEADER, resolved.slug);

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    // Everything except Next internals and static files; sitemap/robots are per-tenant
    // and must go through resolution.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js)$).*)",
  ],
};
