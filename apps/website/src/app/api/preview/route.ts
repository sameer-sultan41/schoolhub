import type { ApiSchemas } from "@schoolhub/api-client";
import { type NextRequest, NextResponse } from "next/server";
import { readJson } from "@/lib/api";
import { normalizeHost } from "@/lib/host";
import {
  PREVIEW_COOKIE,
  PREVIEW_COOKIE_OPTIONS,
  PREVIEW_MAX_AGE_SECONDS,
  PREVIEW_TOKEN_MAX_LENGTH,
} from "@/lib/preview";
import { PAGE_PATH_PATTERN } from "@/lib/regex";

/**
 * Preview entry (website-cms plan decision 9, ADR-0039). The dashboard's preview link lands here,
 * on the school's own host, with `?token=`.
 *
 * The token is validated first, by reading the token's page from the API with the token in
 * `X-Preview-Token`. Only a 200 stores the token (httpOnly, Secure, `SameSite=Lax`, 600 s, the
 * token's own lifetime); Next's Draft Mode is never enabled (see `lib/preview.ts`). The redirect goes to the page path the API
 * returned, never to anything in the request, so this cannot be an open redirect, and an invalid
 * token can never switch on the uncached draft path.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(status: 400 | 404, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message, request_id: "" } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token || token.length > PREVIEW_TOKEN_MAX_LENGTH) {
    return errorResponse(400, "validation_error", "A preview token is required.");
  }

  const host = normalizeHost(request.headers.get("host"));
  if (!host) return errorResponse(404, "not_found", "Preview not found.");

  // No slug: the API answers the token's own page, and 404s a bad, expired or other school's token.
  const page = await readJson<ApiSchemas["PublicPage"]>("/public/pages", {
    host,
    previewToken: token,
  });
  // Only a path the page-slug grammar allows, so nothing a browser could read as another host.
  if (!page || !PAGE_PATH_PATTERN.test(page.path)) {
    return errorResponse(404, "not_found", "Preview not found.");
  }

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
