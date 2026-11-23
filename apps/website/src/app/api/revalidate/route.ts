import { revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { hostTag, tenantTag } from "@/lib/api";
import { env } from "@/lib/env";
import { normalizeHost } from "@/lib/host";
import { SHA256_PREFIX_PATTERN } from "@/lib/regex";

/**
 * Publish-time invalidation webhook (website-builder.md §3).
 *
 * The API emits `website.content_published` when a tenant publishes CMS changes — or when
 * module data feeding a section changes — and this endpoint drops the affected tenant's
 * cache tags so the next request re-renders. Edits go live in seconds without cold-rendering
 * every request.
 *
 * Besides the tenant's own `tenant:<id>…` tags, a signed body may name host tags: the API sends
 * `tenant-host:<host>` for every host of the school when its settings, module flag or domains
 * change, so the cached `by-host` answer is never stale (plan decision 8).
 *
 * Trust: the HMAC over the raw body is the only check, with one internal secret shared with the
 * API (plan decision 8). A correctly signed body may name **any** tenant (its `tenant_id` is in
 * the body) and any host, and there is no timestamp or nonce, so a captured request can be
 * replayed. That is acceptable because the worst it does is evict cache entries, which the next
 * request rebuilds from the API; the `tenant:` filter below only stops a body widening past the
 * tenant it names.
 *
 * It writes **nothing**: it invalidates a cache. The renderer's read-only machine token is not
 * involved.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOST_TAG_PREFIX = hostTag("");

/** A tag the signing tenant may invalidate; anything else is ignored. */
function isAllowedTag(tag: string, tenantId: string): boolean {
  if (tag.startsWith(HOST_TAG_PREFIX)) {
    // Only a well-formed host, exactly as `hostTag` writes it.
    const host = tag.slice(HOST_TAG_PREFIX.length);
    return normalizeHost(host) === host;
  }
  // `tenant:<id>` or `tenant:<id>:…`, never `tenant:<id>0…` (another tenant whose id it prefixes).
  const own = tenantTag(tenantId);
  return tag === own || tag.startsWith(`${own}:`);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function isSignatureValid(rawBody: string, signature: string | null): Promise<boolean> {
  const secret = env.REVALIDATE_WEBHOOK_SECRET;
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

  return timingSafeEqual(expected, signature.replace(SHA256_PREFIX_PATTERN, "").toLowerCase());
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

  // Always drop the tenant-wide tag; finer tenant tags and host tags come from the body.
  const tags = new Set<string>([tenantTag(tenantId)]);
  if (Array.isArray(payload.tags)) {
    for (const tag of payload.tags) {
      if (typeof tag === "string" && isAllowedTag(tag, tenantId)) tags.add(tag);
    }
  }

  // Next 16 requires a cache-life profile. `{ expire: 0 }` expires matching entries
  // immediately, which is what "the school just published" means — a named profile like
  // "max" would only invalidate entries already older than that profile's age.
  // `updateTag` would be the read-your-own-writes equivalent, but it is Server-Action only.
  for (const tag of tags) revalidateTag(tag, { expire: 0 });

  return NextResponse.json({ data: { revalidated: [...tags] } });
}
