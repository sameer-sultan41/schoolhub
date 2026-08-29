import { TENANT_HOST_HEADER, TENANT_SLUG_HEADER } from "@/constants";
import { env, tenantOrigin } from "@/env";
import { expect, test } from "@/fixtures";

/**
 * Host → tenant resolution, which the proxy decides before any data is fetched
 * (`apps/website/src/proxy.ts`). These specs need no API, which is why they live in the
 * mocked lane: anything that has to prove a *rendered tenant's* content is correct needs
 * a real backend and belongs in `tests/live`.
 */
test.describe("unknown hosts never fall through to a tenant", () => {
  test("the platform apex shows the neutral landing page", async ({ publicSitePage }) => {
    await publicSitePage.goto();

    await expect(publicSitePage.platformFallback).toBeVisible();
  });

  test("a reserved subdomain is not treated as a school", async ({ page, publicSitePage }) => {
    // `www` is reserved (apps/website/src/lib/host.ts); a school may not claim it.
    await page.goto(`${new URL(env.WEBSITE_URL).protocol}//www.${new URL(env.WEBSITE_URL).host}/`);

    await expect(publicSitePage.platformFallback).toBeVisible();
  });

  test("a client-supplied tenant header cannot select a school", async ({
    page,
    publicSitePage,
  }) => {
    // The proxy deletes inbound x-schoolhub-* headers before setting its own. Without
    // that, anyone could read any school's site by sending one header.
    await page.setExtraHTTPHeaders({
      [TENANT_SLUG_HEADER]: "victim-school",
      [TENANT_HOST_HEADER]: tenantOrigin("victim-school"),
    });

    await publicSitePage.goto();

    await expect(publicSitePage.platformFallback).toBeVisible();
  });

  test("the fallback page is never indexed", async ({ page, publicSitePage }) => {
    await publicSitePage.goto();

    await expect(publicSitePage.platformFallback).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
  });
});
