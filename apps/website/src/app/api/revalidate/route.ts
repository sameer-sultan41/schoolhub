import { revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Publish-time invalidation webhook (website-builder.md §3).
 *
 * The API emits `website.content_published` when a tenant publishes CMS changes — or when
 * module data feeding a section changes — and this endpoint drops the affected tenant's
 * cache tags so the next request re-renders. Edits go live in seconds without cold-rendering
 * every request.
 *
 * This is the app's only non-GET route, and it writes **nothing**: it invalidates a cache.
 * The renderer's read-only machine token is not involved.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function isSignatureValid(rawBody: string, signature: string | null): Promise<boolean> {
  const secret = process.env.REVALIDATE_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(expected, signature.replace(/^sha256=/, "").toLowerCase());
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  // HMAC-SHA256 over the raw body, matching the outbound webhook signing in
  // api-architecture.md §2.6. Reject before parsing anything.
  if (!(await isSignatureValid(rawBody, request.headers.get("x-schoolhub-signature")))) {
    return NextResponse.json(
      { error: { code: "authentication_failed", message: "Invalid signature.", request_id: "" } },
      { status: 401 },
    );
  }

  let payload: { tenant_id?: unknown; tags?: unknown };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Malformed payload.", request_id: "" } },
      { status: 400 },
    );
  }

  const tenantId = typeof payload.tenant_id === "string" ? payload.tenant_id : null;
  if (!tenantId) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "tenant_id is required.", request_id: "" } },
      { status: 400 },
    );
  }

  // Always drop the tenant-wide tag; optional finer tags let a single-page publish be cheap.
  const tags = new Set<string>([`tenant:${tenantId}`]);
  if (Array.isArray(payload.tags)) {
    for (const tag of payload.tags) {
      // Only ever invalidate within the tenant that signed the request.
      if (typeof tag === "string" && tag.startsWith(`tenant:${tenantId}`)) tags.add(tag);
    }
  }

  // Next 16 requires a cache-life profile. `{ expire: 0 }` expires matching entries
  // immediately, which is what "the school just published" means — a named profile like
  // "max" would only invalidate entries already older than that profile's age.
  // `updateTag` would be the read-your-own-writes equivalent, but it is Server-Action only.
  for (const tag of tags) revalidateTag(tag, { expire: 0 });

  return NextResponse.json({ data: { revalidated: [...tags] } });
}
