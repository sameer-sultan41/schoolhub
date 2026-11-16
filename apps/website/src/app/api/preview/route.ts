import type { ApiSchemas } from "@schoolhub/api-client";
import { draftMode } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { readJson } from "@/lib/api";
import { normalizeHost } from "@/lib/host";
import { PREVIEW_COOKIE, PREVIEW_COOKIE_OPTIONS, PREVIEW_MAX_AGE_SECONDS } from "@/lib/preview";

/**
 * Preview entry (website-cms plan decision 9, ADR-0039). The dashboard's preview link lands here,
 * on the school's own host, with `?token=`.
 *
 * The token is validated first, by reading the token's page from the API with the token in
 * `X-Preview-Token`. Only a 200 enables Draft Mode and stores the token (httpOnly, Secure,
 * `SameSite=Lax`, 600 s, the token's own lifetime). The redirect goes to the page path the API
 * returned, never to anything in the request, so this cannot be an open redirect, and an invalid
 * token can never switch on the uncached draft path.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Comfortably above a signed `tenant_id:page_id` token; anything longer is not one. */
const TOKEN_MAX_LENGTH = 512;

function errorResponse(status: 400 | 404, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message, request_id: "" } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** A site path from the API: `/` or `/<slug>`, never `//host` or `/\host`. */
function isSitePath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\");
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token || token.length > TOKEN_MAX_LENGTH) {
    return errorResponse(400, "validation_error", "A preview token is required.");
  }

  const host = normalizeHost(request.headers.get("host"));
  if (!host) return errorResponse(404, "not_found", "Preview not found.");

  // No slug: the API answers the token's own page, and 404s a bad, expired or other school's token.
  const page = await readJson<ApiSchemas["PublicPage"]>("/public/pages", {
    host,
    previewToken: token,
  });
  if (!page || !isSitePath(page.path)) {
    return errorResponse(404, "not_found", "Preview not found.");
  }

  (await draftMode()).enable();

  // A relative Location stays on the host the editor opened, whatever origin the server sees.
  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: page.path, "Cache-Control": "no-store" },
  });
  response.cookies.set(PREVIEW_COOKIE, token, {
    ...PREVIEW_COOKIE_OPTIONS,
    maxAge: PREVIEW_MAX_AGE_SECONDS,
  });
  return response;
}
