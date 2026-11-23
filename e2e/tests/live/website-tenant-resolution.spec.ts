import { env, tenantOrigin } from "@/env";
import { expect, test } from "@/fixtures";
import {
  E2E_WEBSITE_ABOUT_HEADING,
  E2E_WEBSITE_HOME_HEADING,
  E2E_WEBSITE_OTHER_HOME_HEADING,
} from "@/lib/seed-constants";

/**
 * A seeded school's host renders its published site, read from the real public content API.
 *
 * The path: the proxy parses `<slug>.<platform-domain>`; the root layout asks
 * `/public/tenants/by-host?host=…` with the renderer's machine token (the live lane builds the
 * renderer with the token the API was started with); `seed_e2e_website` made the site live and
 * `module.website` is on, so the tenant resolves `active`; the page then reads
 * `/public/pages?host=…`, which answers the published home page and its sections.
 *
 * The site renders on the server, so nothing here can be stubbed from the browser.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("website tenant resolution", () => {
  test("a seeded school's host renders its published homepage", async ({ publicSitePage }) => {
    await publicSitePage.goto({ path: tenantOrigin(env.LIVE_TENANT_SLUG) });

    // The hero's heading is the page's only h1 (sections below it use h2).
    await expect(publicSitePage.heading).toHaveText(E2E_WEBSITE_HOME_HEADING);
  });

  test("a published page renders on its own path", async ({ publicSitePage }) => {
    await publicSitePage.goto({ path: `${tenantOrigin(env.LIVE_TENANT_SLUG)}/about` });

    await expect(publicSitePage.sectionHeading(E2E_WEBSITE_ABOUT_HEADING)).toBeVisible();
  });

  test("each host renders its own school's homepage", async ({ publicSitePage }) => {
    await publicSitePage.goto({ path: tenantOrigin(env.LIVE_OTHER_TENANT_SLUG) });

    await expect(publicSitePage.heading).toHaveText(E2E_WEBSITE_OTHER_HOME_HEADING);
  });
});
