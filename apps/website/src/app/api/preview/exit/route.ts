import { NextResponse } from "next/server";
import { PREVIEW_COOKIE, PREVIEW_COOKIE_OPTIONS } from "@/lib/preview";

/**
 * Leave preview: the token cookie cleared, back to the published homepage. A POST from the
 * banner's form: unlike a link, a form is never prefetched, so the preview cannot end on its own.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST() {
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: "/", "Cache-Control": "no-store" },
  });
  response.cookies.set(PREVIEW_COOKIE, "", { ...PREVIEW_COOKIE_OPTIONS, maxAge: 0 });
  return response;
}
