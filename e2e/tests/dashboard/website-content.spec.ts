import { expect, test } from "@/fixtures";
import { buildRole, buildUser } from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  buildGalleryAlbum,
  buildGalleryItem,
  buildNewsPost,
  type GalleryItem,
  type MockApi,
  type NewsPost,
  websiteContentModule,
} from "@/mocks";

/**
 * News, events and gallery (website-cms PR G) against a stubbed API. The stub
 * (`websiteContentModule`) enforces the server's rules these screens surface (L5): slug rules,
 * `end_before_start`, a video link's rules, `empty_album`, `unpublish_first` and a reorder that
 * lists every item exactly once. Whether the server really does is the backend suite's.
 */

/** The seeded `school_admin`'s content keys (`website_cms/permissions.py`: `CONTENT_EDITORS`,
 * `PUBLISHERS`). */
const schoolAdmin = buildUser({
  roles: [buildRole({ slug: "school_admin", name: "School Admin" })],
  permissions: [
    "website.page.view",
    "website.news-post.create",
    "website.news-post.update",
    "website.news-post.delete",
    "website.news-post.publish",
    "website.school-event.create",
    "website.school-event.update",
    "website.school-event.publish",
    "website.gallery-album.create",
    "website.gallery-album.update",
    "website.gallery-album.publish",
    "website.gallery-album.delete",
  ],
});

/** A `principal` reads website content and publishes pages and news, nothing more (§4). */
const principal = buildUser({
  roles: [buildRole({ slug: "principal", name: "Principal" })],
  permissions: ["website.page.view", "website.page.publish", "website.news-post.publish"],
});

const REORDER_PATH = /\/gallery-albums\/[^/]+\/gallery-items:reorder$/;
const EVENTS_PATH = /\/school-events$/;

function stubNews(mockApi: MockApi): NewsPost[] {
  const posts = [buildNewsPost({ title: "Library week", slug: "library-week" })];
  mockApi.use(websiteContentModule({ newsPosts: posts }));
  return posts;
}

test.describe("the school admin", () => {
  test.use({ authUser: schoolAdmin });

  test("reaches News from the Website menu, writes a post and publishes it", async ({
    page,
    mockApi,
    dashboardPage,
    websiteContentPage,
    signedIn: _signedIn,
  }) => {
    const posts = stubNews(mockApi);
    await dashboardPage.goto();

    await dashboardPage.navGroup("Website").click();
    await dashboardPage.navLink("News").click();
    await expect(page).toHaveURL(/\/website\/news$/);

    await page.getByRole("button", { name: "New post", exact: true }).click();
    const form = websiteContentPage.dialog("New post");
    await form.getByLabel("Title").fill("Sports Day 2026");
    await expect(form.getByLabel("Address")).toHaveValue("sports-day-2026");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect(form).toHaveCount(0);

    const row = websiteContentPage.row("News posts", "Sports Day 2026");
    await expect(row.getByText("Draft", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "Sports Day 2026" }).click();
    const sheet = websiteContentPage.dialog("Sports Day 2026");
    await sheet.getByRole("button", { name: "Publish", exact: true }).click();

    await expect(sheet.getByRole("button", { name: "Unpublish", exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    expect(posts.find((post) => post.slug === "sports-day-2026")?.status).toBe("published");
  });

  test("shows a taken address under its field", async ({
    mockApi,
    websiteContentPage,
    page,
    signedIn: _signedIn,
  }) => {
    stubNews(mockApi);
    await websiteContentPage.goto();

    await page.getByRole("button", { name: "New post", exact: true }).click();
    const form = websiteContentPage.dialog("New post");
    await form.getByLabel("Title").fill("Library week");
    await form.getByRole("button", { name: "Save", exact: true }).click();

    await expect(form.getByText("Another item already uses this address.")).toBeVisible();
  });

  test("refuses an event that ends before it starts without a request", async ({
    page,
    mockApi,
    websiteContentPage,
    signedIn: _signedIn,
  }) => {
    mockApi.use(websiteContentModule());
    await websiteContentPage.gotoEvents();
    let createSent = false;
    page.on("request", (request) => {
      if (isApiCall(request, "POST", EVENTS_PATH)) createSent = true;
    });

    await page.getByRole("button", { name: "New event", exact: true }).click();
    const form = websiteContentPage.dialog("New event");
    await form.getByLabel("Title").fill("Prize day");
    await form.getByLabel("Starts").fill("2026-12-10T10:00");
    await form.getByLabel("Ends").fill("2026-12-10T09:00");
    await form.getByRole("button", { name: "Save", exact: true }).click();

    await expect(form.getByText("The event can't end before it starts.")).toBeVisible();
    expect(createSent).toBe(false);
  });

  test("reorders an album's items and is told a video host is not allowed", async ({
    page,
    mockApi,
    websiteContentPage,
    signedIn: _signedIn,
  }) => {
    const album = buildGalleryAlbum();
    const items: GalleryItem[] = [
      buildGalleryItem({ gallery_album_id: album.id, caption: "Opening", alt_text: "The gate" }),
      buildGalleryItem({ gallery_album_id: album.id, caption: "Judging", position: 1 }),
    ];
    mockApi.use(websiteContentModule({ albums: [album], items }));
    await websiteContentPage.gotoAlbum(album.id);

    await expect(websiteContentPage.albumItem(2).getByText("Needs a description")).toBeVisible();
    const reorder = page.waitForRequest((request) => isApiCall(request, "PATCH", REORDER_PATH));
    await page.getByRole("button", { name: "Move item 1 later", exact: true }).click();
    expect((await reorder).postDataJSON()).toEqual({
      ids: [items[1]?.id, items[0]?.id],
    });
    await expect(websiteContentPage.albumItem(1).getByText("Judging")).toBeVisible();

    await page.getByRole("button", { name: "Add video", exact: true }).click();
    const form = websiteContentPage.dialog("Add a video");
    await form.getByLabel("Video link").fill("https://www.dailymotion.com/video/x1");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect(form.getByText("This video site isn't supported.")).toBeVisible();
  });

  test("names why an empty album can't be published", async ({
    page,
    mockApi,
    websiteContentPage,
    signedIn: _signedIn,
  }) => {
    const album = buildGalleryAlbum({ title: "Winter concert" });
    mockApi.use(websiteContentModule({ albums: [album] }));
    await websiteContentPage.gotoAlbum(album.id);

    await page.getByRole("button", { name: "Publish", exact: true }).click();

    await expect(
      page.getByText("Add at least one photo or video before publishing this album."),
    ).toBeVisible();
    expect(album.status).toBe("draft");
  });
});

test.describe("the principal", () => {
  test.use({ authUser: principal });

  test("may publish news but not write it", async ({
    page,
    mockApi,
    websiteContentPage,
    signedIn: _signedIn,
  }) => {
    stubNews(mockApi);
    await websiteContentPage.goto();

    await websiteContentPage
      .row("News posts", "Library week")
      .getByRole("button", { name: "Library week" })
      .click();
    const sheet = websiteContentPage.dialog("Library week");

    await expect(sheet.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New post", exact: true })).toHaveCount(0);
  });
});
