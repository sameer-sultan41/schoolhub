import { env, tenantOrigin } from "@/env";
import { expect, test } from "@/fixtures";

/**
 * BLOCKED on a backend module that does not exist yet: `apps/api` has no public-content
 * API (no `/public/tenants/by-host`, no CMS-pages endpoint — see
 * `apps/api/config/api_v1.py`, which routes only `core.rbac` and
 * `apps.school_organization`). `resolveTenant()` (apps/website/src/lib/tenant.ts) 404s for
 * every host, including a real, seeded tenant, so the website falls back to the
 * platform-landing page regardless of which host resolved it.
 *
 * This pins that real, current behavior — even for a genuinely seeded tenant — rather
 * than silently omitting coverage. Once the public-content API ships, replace this with a
 * test asserting real rendered tenant content (add a content locator to
 * `PublicSitePage` at that point; none exists yet, since inventing one against markup
 * that cannot currently render would violate this suite's own locate-from-what's-real
 * discipline).
 */
test.describe("website tenant resolution (blocked on public-content API)", () => {
  test("a real, seeded tenant host still falls back — the backend it needs does not exist yet", async ({
    publicSitePage,
  }) => {
    await publicSitePage.goto({ path: tenantOrigin(env.LIVE_TENANT_SLUG) });

    await expect(publicSitePage.platformFallback).toBeVisible();
  });
});
