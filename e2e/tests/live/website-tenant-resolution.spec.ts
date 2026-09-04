import { env, tenantOrigin } from "@/env";
import { expect, test } from "@/fixtures";

/**
 * BLOCKED on a backend module that does not exist yet: `apps/api` has no public-content
 * API (no `/public/tenants/by-host`, no CMS-pages endpoint — see
 * `apps/api/config/api_v1.py`, which routes only `core.rbac` and
 * `apps.school_organization`). `resolveTenant()` (apps/website/src/lib/tenant.ts) 404s for
 * every host, including a real, seeded tenant.
 *
 * This is *not* the same fallback as an unrecognizable host: a well-formed tenant
 * subdomain (`<slug>.<platform-domain>`, confirmed against the real running site, not
 * assumed) still routes past the proxy's host-parsing step, then hits the 404'd tenant
 * lookup and renders the standard Next.js not-found page — not the "No school website is
 * configured for this address." platform-landing page, which is reserved for a host the
 * proxy cannot even parse as a tenant subdomain. `tests/live/tenant-isolation.spec.ts`'s
 * header-spoofing test already covers that unparseable-host case.
 *
 * This pins that real, current behavior — even for a genuinely seeded tenant — rather
 * than silently omitting coverage. Once the public-content API ships, replace this with a
 * test asserting real rendered tenant content.
 */
test.describe("website tenant resolution (blocked on public-content API)", () => {
  test("a real, seeded tenant host 404s to the generic not-found page — the backend it needs does not exist yet", async ({
    publicSitePage,
  }) => {
    await publicSitePage.goto({ path: tenantOrigin(env.LIVE_TENANT_SLUG) });

    await expect(publicSitePage.notFound).toBeVisible();
  });
});
