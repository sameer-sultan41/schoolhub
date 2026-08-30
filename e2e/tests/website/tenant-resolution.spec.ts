import { env } from "@/env";
import { expect, test } from "@/fixtures";

/**
 * Host → tenant resolution, which the proxy decides before any data is fetched
 * (`apps/website/src/proxy.ts`). These specs need no API, which is why they live in the
 * mocked lane.
 *
 * What is *not* here: the proxy's stripping of inbound `x-schoolhub-*` headers. Reaching
 * the code that reads those headers requires a host that resolves to a real tenant, which
 * requires the API — so that assertion lives in `tests/live/`. Asserting it against the
 * platform apex would pass whether or not the stripping existed, because an unresolvable
 * host is rewritten to `/_platform`, and `/_platform` reads no tenant header at all.
 */
test.describe("unknown hosts never fall through to a tenant", () => {
  test("the platform apex shows the neutral landing page", async ({ publicSitePage }) => {
    await publicSitePage.goto();

    await expect(publicSitePage.platformFallback).toBeVisible();
  });

  test("a reserved subdomain is not treated as a school", async ({ page, publicSitePage }) => {
    // `www` is reserved (apps/website/src/lib/host.ts); a school may not claim it.
    const website = new URL(env.WEBSITE_URL);
    await page.goto(`${website.protocol}//www.${website.host}/`);

    await expect(publicSitePage.platformFallback).toBeVisible();
  });

  test("a deep path on an unknown host also lands on the fallback", async ({ publicSitePage }) => {
    // The rewrite is not limited to "/" — no path on an unresolvable host may reach a
    // tenant's CMS route.
    await publicSitePage.goto({ path: "/admissions/apply" });

    await expect(publicSitePage.platformFallback).toBeVisible();
  });

  test("the fallback page is never indexed", async ({ page, publicSitePage }) => {
    await publicSitePage.goto();

    await expect(publicSitePage.platformFallback).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });
});
