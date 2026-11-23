import { randomUUID } from "node:crypto";
import type { ApiSchemas } from "@schoolhub/api-client";
import { env, tenantOrigin } from "@/env";
import { expect, test } from "@/fixtures";
import {
  E2E_WEBSITE_ALBUM_SLUG,
  E2E_WEBSITE_ALBUM_TITLE,
  E2E_WEBSITE_CONTACT_HEADING,
  E2E_WEBSITE_DRAFT_PAGE_HEADING,
  E2E_WEBSITE_DRAFT_PAGE_SLUG,
  E2E_WEBSITE_HOME_HEADING,
  E2E_WEBSITE_IMAGE_ALT,
  E2E_WEBSITE_NEWS_BODY,
  E2E_WEBSITE_NEWS_SLUG,
  E2E_WEBSITE_NEWS_TITLE,
  E2E_WEBSITE_OTHER_HOME_HEADING,
} from "@/lib/seed-constants";

type ContactSubmission = ApiSchemas["ContactSubmission"];
type NewsPost = ApiSchemas["NewsPostDetail"];
type NewsPostWrite = ApiSchemas["NewsPostWrite"];

/**
 * The public site's content, served by the real public content API (`seed_e2e_website`).
 *
 * Every read here is the renderer's server-side fetch with its machine token, resolving the
 * school from the request's host; the API binds that school for RLS. Only the contact form and
 * the album image are fetched by the browser itself, from `NEXT_PUBLIC_API_ORIGIN` and the API's
 * public file redirect, which is why the live lane builds the renderer with that origin and with
 * images unoptimised.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const schoolSite = tenantOrigin(env.LIVE_TENANT_SLUG);
const otherSchoolSite = tenantOrigin(env.LIVE_OTHER_TENANT_SLUG);

test.describe("website content", () => {
  test("a published news post renders on its detail page", async ({ publicSitePage, page }) => {
    await publicSitePage.goto({ path: `${schoolSite}/news/${E2E_WEBSITE_NEWS_SLUG}` });

    await expect(publicSitePage.heading).toHaveText(E2E_WEBSITE_NEWS_TITLE);
    // The rich-text body, rendered from its block document.
    await expect(page.getByText(E2E_WEBSITE_NEWS_BODY, { exact: true })).toBeVisible();
  });

  test("a draft page is not found", async ({ publicSitePage, page }) => {
    // The page exists with a visible section; only its draft status keeps it off the site
    // (`/public/pages` answers 404 for it). `/about`, on the same route, renders.
    await publicSitePage.goto({ path: `${schoolSite}/${E2E_WEBSITE_DRAFT_PAGE_SLUG}` });

    await expect(publicSitePage.notFound).toBeVisible();
    await expect(page.getByText(E2E_WEBSITE_DRAFT_PAGE_HEADING)).toHaveCount(0);
  });

  test("an album shows its image, loaded through the public file redirect", async ({
    publicSitePage,
  }) => {
    await publicSitePage.goto({ path: `${schoolSite}/gallery/${E2E_WEBSITE_ALBUM_SLUG}` });

    await expect(publicSitePage.heading).toHaveText(E2E_WEBSITE_ALBUM_TITLE);
    const image = publicSitePage.image(E2E_WEBSITE_IMAGE_ALT);
    await image.scrollIntoViewIfNeeded();
    // Decoded pixels prove the whole chain: API redirect (file public once the album was
    // published) → presigned storage URL → the stored PNG. A broken one has no natural width.
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBeGreaterThan(0);
  });

  test("a contact message is accepted and reaches that school's inbox only", async ({
    publicSitePage,
    liveApiClient,
    liveOtherTenantApiClient,
  }) => {
    const email = `e2e-contact-${randomUUID().slice(0, 8)}@schoolhub.test`;
    const message = "Is there a place in Grade 1 next term?";

    await publicSitePage.goto({ path: `${schoolSite}/contact` });
    await expect(publicSitePage.sectionHeading(E2E_WEBSITE_CONTACT_HEADING)).toBeVisible();
    await publicSitePage.contactName.fill("E2E Visitor");
    await publicSitePage.contactEmail.fill(email);
    await publicSitePage.contactMessage.fill(message);
    await publicSitePage.sendMessage.click();

    // Shown only for a 2xx from the API's contact endpoint (a 404 from the renderer's own
    // origin, the failure when NEXT_PUBLIC_API_ORIGIN is missing, shows the error instead).
    await expect(publicSitePage.contactSent).toBeVisible();

    const { data: inbox } = await liveApiClient.get<ContactSubmission[]>("/contact-submissions", {
      query: { search: email },
    });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ name: "E2E Visitor", email, message, status: "new" });

    // The other school's staff never see it: RLS scopes the inbox to the session's school.
    const { data: otherInbox } = await liveOtherTenantApiClient.get<ContactSubmission[]>(
      "/contact-submissions",
      { query: { search: email } },
    );
    expect(otherInbox).toHaveLength(0);
  });

  test("another school's host never shows this school's news", async ({ publicSitePage, page }) => {
    // The other school's site is live (its own homepage renders), so the 404 below comes from
    // the content lookup scoped to that host's school, not from an unpublished site. Its
    // homepage has a news list too: it reads `/public/news-posts?host=<other>`, which returns
    // none of this school's posts (an empty list renders no section at all).
    await publicSitePage.goto({ path: otherSchoolSite });
    await expect(publicSitePage.heading).toHaveText(E2E_WEBSITE_OTHER_HOME_HEADING);
    await expect(publicSitePage.link(E2E_WEBSITE_NEWS_TITLE)).toHaveCount(0);

    await publicSitePage.goto({ path: `${otherSchoolSite}/news/${E2E_WEBSITE_NEWS_SLUG}` });

    await expect(publicSitePage.notFound).toBeVisible();
    await expect(page.getByText(E2E_WEBSITE_NEWS_TITLE)).toHaveCount(0);
  });

  test("publishing a news post refreshes the cached homepage through the webhook", async ({
    publicSitePage,
    liveApiClient,
  }) => {
    // Polls for the webhook below, past the default 30 s budget.
    test.setTimeout(60_000);
    // Warm the renderer's data cache first: without the webhook, the cached news list would
    // refresh only after CONTENT_REVALIDATE_SECONDS (300 s), far past this test's deadline.
    await publicSitePage.goto({ path: schoolSite });
    await expect(publicSitePage.heading).toHaveText(E2E_WEBSITE_HOME_HEADING);

    const suffix = randomUUID().slice(0, 8);
    const title = `E2E revalidation ${suffix}`;
    const write: NewsPostWrite = {
      title,
      slug: `e2e-revalidation-${suffix}`,
      body: { blocks: [{ type: "paragraph", text: "Published to test revalidation." }] },
    };
    const { data: post } = await liveApiClient.post<NewsPost>("/news-posts", write);
    try {
      // Publish queues `website_cms.revalidate_website`; the worker signs and POSTs it to the
      // renderer's /api/revalidate, which drops every read tagged with this school.
      await liveApiClient.post(`/news-posts/${post.id}:publish`);

      await expect(async () => {
        await publicSitePage.goto({ path: schoolSite });
        await expect(publicSitePage.link(title)).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 45_000 });
    } finally {
      // Off the homepage list again, so a re-run on the same stack starts from the seed.
      await liveApiClient.post(`/news-posts/${post.id}:unpublish`);
      await liveApiClient.delete(`/news-posts/${post.id}`);
    }
  });
});
