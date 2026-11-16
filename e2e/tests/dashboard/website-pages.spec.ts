import { expect, test } from "@/fixtures";
import { buildRole, buildUser } from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  buildPageSection,
  buildWebsitePage,
  type MockApi,
  pagePreviewUrl,
  type WebsitePage,
  websitePagesModule,
} from "@/mocks";

/**
 * The Website pages directory and page editor (PR F) against a stubbed API. The stub
 * (`websitePagesModule`) enforces the server's rules the screens surface (L5): reserved and
 * taken addresses, publishing only with a visible section, and no delete of the home page or a
 * menu's target. Whether the server really does is the live lane's.
 */

/** A `school_owner`'s page keys (website-cms.md §4). */
const editor = buildUser({
  roles: [buildRole({ slug: "school_owner", name: "School Owner" })],
  permissions: [
    "website.page.view",
    "website.page.create",
    "website.page.update",
    "website.page.delete",
    "website.page.publish",
  ],
});

const SECTIONS_PATH = /\/website-pages\/[^/]+\/page-sections$/;
const PUBLISH_PATH = /\/website-pages\/[^/]+:publish$/;

interface World {
  pages: WebsitePage[];
  home: WebsitePage;
  about: WebsitePage;
  admissions: WebsitePage;
}

/** The home page (published), "About us" (a draft a menu links to) and "Admissions" (a draft
 * with a hero and a news list), built per test: a test's writes change them. */
function stubWebsite(mockApi: MockApi): World {
  const home = buildWebsitePage({
    title: "Home",
    slug: "home",
    page_type: "home",
    status: "published",
    sections: [buildPageSection()],
  });
  const about = buildWebsitePage({ title: "About us", slug: "about", page_type: "about" });
  const admissions = buildWebsitePage({
    title: "Admissions",
    slug: "admissions",
    page_type: "admissions",
    sections: [
      buildPageSection({ content: { heading: "Join us" } }),
      buildPageSection({
        section_type: "news_list",
        position: 1,
        content: { heading: "Latest news", limit: 3 },
      }),
    ],
  });
  const pages = [home, about, admissions];
  mockApi.use(websitePagesModule({ pages, menuTargets: [about.id] }));
  return { pages, home, about, admissions };
}

test.describe("the website pages", () => {
  test.use({ authUser: editor });

  test("lists the pages from the sidebar and keeps a filter across a reload", async ({
    page,
    mockApi,
    dashboardPage,
    websitePagesPage,
    signedIn: _signedIn,
  }) => {
    stubWebsite(mockApi);
    await dashboardPage.goto();
    await dashboardPage.navGroup("Website").click();
    await dashboardPage.navLink("Pages").click();

    await expect(page).toHaveURL(/\/website\/pages$/);
    await expect(websitePagesPage.row("Home").getByText("/", { exact: true })).toBeVisible();
    await expect(websitePagesPage.row("About us")).toBeVisible();

    await websitePagesPage.filter("Status").click();
    await page.getByRole("option", { name: "Published", exact: true }).click();
    await expect(page).toHaveURL(/status=published/);
    await expect(websitePagesPage.row("About us")).toHaveCount(0);

    await page.reload();
    await expect(websitePagesPage.row("Home")).toBeVisible();
    await expect(websitePagesPage.row("About us")).toHaveCount(0);
  });

  test("refuses a reserved address with the server's reason, under the address", async ({
    page,
    mockApi,
    websitePagesPage,
    signedIn: _signedIn,
  }) => {
    stubWebsite(mockApi);
    await websitePagesPage.goto();

    await websitePagesPage.createButton.click();
    const dialog = websitePagesPage.detailsDialog;
    await dialog.getByLabel("Title").fill("School news");
    await dialog.getByLabel("Address").fill("news/archive");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();

    await expect(
      dialog.getByText("This address is reserved for the website. Choose another."),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/website\/pages$/);
  });

  test("creates a page, adds and orders its sections, then publishes it", async ({
    page,
    mockApi,
    websitePagesPage,
    signedIn: _signedIn,
  }) => {
    const { pages } = stubWebsite(mockApi);
    await websitePagesPage.goto();

    await websitePagesPage.createButton.click();
    const dialog = websitePagesPage.detailsDialog;
    await dialog.getByLabel("Title").fill("Uniform");
    await dialog.getByLabel("Address").fill("uniform");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Uniform", level: 1 })).toBeVisible();
    const created = pages.find((candidate) => candidate.slug === "uniform");
    expect(created?.page_type).toBe("standard");

    // Nothing visible yet: Publish waits, and says why.
    await expect(websitePagesPage.publishButton).toBeDisabled();
    await expect(
      page.getByText("Add a visible section and save it before publishing."),
    ).toBeVisible();

    await websitePagesPage.addSectionButton.click();
    await websitePagesPage.sectionType("News").click();
    await page.getByLabel("Heading").fill("Uniform news");
    await websitePagesPage.addSectionButton.click();
    await websitePagesPage.sectionType("Hero").click();
    await page.getByLabel("Heading").fill("Our uniform");
    await expect(websitePagesPage.sectionRows).toHaveCount(2);
    await websitePagesPage.moveDown(1).click();

    const saved = page.waitForResponse((response) =>
      isApiCall(response.request(), "PATCH", SECTIONS_PATH),
    );
    await websitePagesPage.saveSectionsButton.click();
    const body = (await saved).request().postDataJSON() as {
      sections: { section_type: string; content: Record<string, unknown> }[];
    };
    expect(body.sections.map((section) => section.section_type)).toEqual(["hero", "news_list"]);
    expect(body.sections[0]?.content).toEqual({ heading: "Our uniform" });

    const published = page.waitForResponse((response) =>
      isApiCall(response.request(), "POST", PUBLISH_PATH),
    );
    await websitePagesPage.publishButton.click();
    await published;
    await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
    expect(created?.status).toBe("published");
  });

  test("explains why a page a menu links to can't be deleted", async ({
    mockApi,
    websitePagesPage,
    signedIn: _signedIn,
  }) => {
    const { about, pages } = stubWebsite(mockApi);
    await websitePagesPage.gotoPage(about.id);

    await websitePagesPage.deleteButton.click();
    const confirm = websitePagesPage.deleteDialog;
    await confirm.getByRole("button", { name: "Delete page", exact: true }).click();

    await expect(
      confirm.getByText(
        "This page can't be removed: it is the home page, or a menu links to it. Take it out of the menus first.",
      ),
    ).toBeVisible();
    expect(pages).toContain(about);
  });

  test("offers no delete on the home page", async ({
    page,
    mockApi,
    websitePagesPage,
    signedIn: _signedIn,
  }) => {
    const { home } = stubWebsite(mockApi);
    await websitePagesPage.gotoPage(home.id);

    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    await expect(websitePagesPage.deleteButton).toHaveCount(0);
  });

  test("opens the preview in a new tab at the URL the API returned", async ({
    page,
    mockApi,
    websitePagesPage,
    signedIn: _signedIn,
  }) => {
    const { admissions } = stubWebsite(mockApi);
    const url = pagePreviewUrl(admissions.id);
    // The school's own site is not under test: answer the preview host with a stand-in.
    await page
      .context()
      .route(`${new URL(url).origin}/**`, (route) =>
        route.fulfill({ contentType: "text/html", body: "<p>Preview</p>" }),
      );
    await websitePagesPage.gotoPage(admissions.id);
    await expect(websitePagesPage.sectionRows).toHaveCount(2);

    const opened = page.context().waitForEvent("page");
    await websitePagesPage.previewButton.click();
    const preview = await opened;

    await preview.waitForURL(url);
    expect(preview.url()).toBe(url);
    expect(await preview.evaluate(() => window.opener === null)).toBe(true);
  });
});
