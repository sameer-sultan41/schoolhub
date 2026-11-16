import { expect, test } from "@/fixtures";
import { buildRole, buildUser } from "@/data/factories";
import {
  buildContactSubmission,
  buildCustomDomain,
  buildNavigationMenu,
  buildWebsitePage,
  buildWebsiteSettings,
  type ContactSubmission,
  type CustomDomain,
  type MockApi,
  type NavigationMenu,
  type WebsiteSettings,
  websitePagesModule,
  websiteSiteModule,
} from "@/mocks";

/**
 * Site settings, navigation, custom domains and the contact inbox (website-cms PR H) against a
 * stubbed API (`websiteSiteModule`, with `websitePagesModule` for the reads they share). The stub
 * mirrors the server's rules these screens surface (L5); whether the server enforces them is the
 * backend suite's. Each role below holds exactly its seeded website keys
 * (`apps/api/apps/website_cms/permissions.py`).
 */

/** `it_admin`: `PAGE_READERS`, `SITE_ADMINS` and `DOMAIN_ADMINS`. */
const itAdmin = buildUser({
  roles: [buildRole({ slug: "it_admin", name: "IT Admin" })],
  permissions: [
    "website.page.view",
    "website.navigation.update",
    "website.settings.update",
    "website.seo.update",
    "website.custom-domain.create",
    "website.custom-domain.update",
    "website.custom-domain.delete",
  ],
});

/** `school_owner`: `DOMAIN_ADMINS` only. */
const schoolOwner = buildUser({
  roles: [buildRole({ slug: "school_owner", name: "School Owner" })],
  permissions: [
    "website.custom-domain.create",
    "website.custom-domain.update",
    "website.custom-domain.delete",
  ],
});

/** `reception`: `INBOX_STAFF` only. */
const reception = buildUser({
  roles: [buildRole({ slug: "reception", name: "Reception" })],
  permissions: ["website.contact-submission.view", "website.contact-submission.update"],
});

interface SiteState {
  settings: WebsiteSettings;
  menus: NavigationMenu[];
  domains: CustomDomain[];
  submissions: ContactSubmission[];
}

/** The stubs for one test, with the state a spec reads back after a save. */
function stubSite(
  mockApi: MockApi,
  state: Partial<SiteState> = {},
  dns: Record<string, "pass" | "txt_mismatch" | "domain_taken"> = {},
): SiteState {
  const about = buildWebsitePage({ title: "About us", slug: "about", status: "published" });
  const site: SiteState = {
    settings: buildWebsiteSettings(),
    menus: [
      buildNavigationMenu("header", [
        {
          label: "About",
          target_type: "page",
          target: about.id,
          children: [
            { label: "History", target_type: "url", target: "/about/history" },
            { label: "Staff", target_type: "url", target: "/about/staff" },
          ],
        },
        { label: "News", target_type: "news_index", target: null, children: [] },
      ]),
      buildNavigationMenu("footer_primary"),
      buildNavigationMenu("footer_secondary"),
    ],
    domains: [],
    submissions: [],
    ...state,
  };
  mockApi.use(websitePagesModule({ pages: [about], settings: site.settings }));
  mockApi.use(websiteSiteModule({ ...site, dns }));
  return site;
}

test.describe("the IT admin", () => {
  test.use({ authUser: itAdmin });

  test("confirms maintenance mode, then saves the analytics id", async ({
    page,
    mockApi,
    websiteSitePage,
    signedIn: _signedIn,
  }) => {
    const { settings } = stubSite(mockApi);
    await websiteSitePage.goto();

    await page.getByRole("switch", { name: "Maintenance mode", exact: true }).click();
    const confirm = websiteSitePage.alertDialog("Turn on maintenance mode?");
    await confirm.getByRole("button", { name: "Turn on", exact: true }).click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByText("Maintenance", { exact: true })).toBeVisible();
    expect(settings.maintenance_mode).toBe(true);

    await page.getByRole("textbox", { name: "Analytics ID", exact: true }).fill("G-GREENFIELD1");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Site settings saved.")).toBeVisible();
    expect(settings.analytics_id).toBe("G-GREENFIELD1");
  });

  test("drags a sub-link without moving its parent, and saves the new order", async ({
    page,
    mockApi,
    websiteSitePage,
    signedIn: _signedIn,
  }) => {
    // The H1 review's real-browser check: a pointer drag inside the nested list must stay there.
    const { menus } = stubSite(mockApi);
    await websiteSitePage.gotoNavigation();
    await expect(websiteSitePage.menuTab("Header")).toHaveAttribute("aria-selected", "true");
    await expect(websiteSitePage.subLinks("About")).toHaveCount(2);

    await websiteSitePage.dragOnto(
      websiteSitePage.subLinkHandle(2, 1),
      websiteSitePage.subLink(1, 1),
    );

    const first = websiteSitePage
      .subLink(1, 1)
      .getByRole("textbox", { name: "Label", exact: true });
    await expect(first).toHaveValue("Staff");
    await expect(websiteSitePage.menuLink(1, "About")).toBeVisible();
    await expect(websiteSitePage.menuLink(2, "News")).toBeVisible();

    await page.getByRole("button", { name: "Save menu", exact: true }).click();
    await expect(page.getByText("Menu saved.")).toBeVisible();
    const header = menus.find((menu) => menu.location === "header");
    expect(header?.items.map((item) => item.label)).toEqual(["About", "News"]);
    expect(header?.items[0]?.children?.map((child) => child.label)).toEqual(["Staff", "History"]);
  });
});

test.describe("the school owner", () => {
  test.use({ authUser: schoolOwner });

  test("reaches only Domains from the Website menu", async ({
    mockApi,
    dashboardPage,
    page,
    signedIn: _signedIn,
  }) => {
    stubSite(mockApi);
    await dashboardPage.goto();

    await dashboardPage.navGroup("Website").click();
    await expect(dashboardPage.navLink("Contact inbox")).toHaveCount(0);
    await dashboardPage.navLink("Domains").click();
    await expect(page).toHaveURL(/\/website\/domains$/);
  });

  test("sees why a check failed, adds a domain and verifies it, held from primary", async ({
    page,
    mockApi,
    websiteSitePage,
    signedIn: _signedIn,
  }) => {
    const pending = buildCustomDomain({ domain: "www.greenfield.edu.pk" });
    stubSite(
      mockApi,
      { domains: [pending] },
      {
        "www.greenfield.edu.pk": "txt_mismatch",
        "greenfield.school": "pass",
      },
    );
    await websiteSitePage.gotoDomains();

    const existing = websiteSitePage.domain("www.greenfield.edu.pk");
    await existing.getByRole("button", { name: "Check DNS", exact: true }).click();
    await expect(existing.getByText("Failed", { exact: true })).toBeVisible();
    await expect(existing.getByText(/The TXT record holds a different value/)).toBeVisible();

    await page.getByRole("button", { name: "Add domain", exact: true }).click();
    const add = websiteSitePage.dialog("Add a custom domain");
    await add.getByRole("textbox", { name: "Domain", exact: true }).fill(" Greenfield.School ");
    await add.getByRole("button", { name: "Add domain", exact: true }).click();
    const steps = websiteSitePage.dialog("Set up greenfield.school");
    await expect(
      steps.getByRole("button", { name: "Copy the TXT record's value", exact: true }),
    ).toBeVisible();
    await expect(
      steps.getByRole("button", { name: "Copy the CNAME record's value", exact: true }),
    ).toBeVisible();
    await steps.getByRole("button", { name: "Done", exact: true }).click();

    const added = websiteSitePage.domain("greenfield.school");
    await added.getByRole("button", { name: "Check DNS", exact: true }).click();
    await expect(added.getByText("Active", { exact: true })).toBeVisible();
    await expect(added.getByText("HTTPS pending", { exact: true })).toBeVisible();
    const primary = added.getByRole("button", { name: "Make primary", exact: true });
    await expect(primary).toBeDisabled();
    await expect(primary).toHaveAccessibleDescription(
      "Can be made primary once its HTTPS certificate is issued.",
    );
  });

  test("is told another school holds a domain, and removes it once confirmed", async ({
    mockApi,
    websiteSitePage,
    signedIn: _signedIn,
  }) => {
    const taken = buildCustomDomain({ domain: "taken.edu.pk" });
    const { domains } = stubSite(mockApi, { domains: [taken] }, { "taken.edu.pk": "domain_taken" });
    await websiteSitePage.gotoDomains();

    const card = websiteSitePage.domain("taken.edu.pk");
    await card.getByRole("button", { name: "Check DNS", exact: true }).click();
    await expect(card.getByText("Another school already uses this domain.")).toBeVisible();

    await card.getByRole("button", { name: "Remove", exact: true }).click();
    const confirm = websiteSitePage.alertDialog("Remove taken.edu.pk?");
    await confirm.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(card).toHaveCount(0);
    expect(domains).toHaveLength(0);
  });
});

test.describe("reception", () => {
  test.use({ authUser: reception });

  function inbox(): ContactSubmission[] {
    return [
      buildContactSubmission({ name: "Ayesha Khan", created_at: "2026-11-10T09:00:00Z" }),
      buildContactSubmission({
        name: "Bilal Ahmed",
        subject: "Fee schedule",
        status: "read",
        created_at: "2026-10-05T09:00:00Z",
      }),
      buildContactSubmission({
        name: "Prize Desk",
        subject: "You have won",
        status: "spam",
        created_at: "2026-11-12T09:00:00Z",
      }),
    ];
  }

  test("reaches only the contact inbox from the Website menu", async ({
    mockApi,
    dashboardPage,
    page,
    signedIn: _signedIn,
  }) => {
    stubSite(mockApi, { submissions: inbox() });
    await dashboardPage.goto();

    await dashboardPage.navGroup("Website").click();
    await expect(dashboardPage.navLink("Domains")).toHaveCount(0);
    await dashboardPage.navLink("Contact inbox").click();
    await expect(page).toHaveURL(/\/website\/inbox$/);
  });

  test("filters new messages, marks one responded, and it leaves the new filter", async ({
    page,
    mockApi,
    websiteSitePage,
    signedIn: _signedIn,
  }) => {
    const { submissions } = stubSite(mockApi, { submissions: inbox() });
    await websiteSitePage.gotoInbox();
    await expect(websiteSitePage.inboxRow("Bilal Ahmed")).toBeVisible();

    await page.getByRole("combobox", { name: "Status", exact: true }).click();
    await page.getByRole("option", { name: "New", exact: true }).click();
    await expect(page).toHaveURL(/status=new/);
    await expect(websiteSitePage.inboxRow("Bilal Ahmed")).toHaveCount(0);

    await page
      .getByRole("button", { name: "Open the message from Ayesha Khan", exact: true })
      .click();
    const sheet = websiteSitePage.dialog("Ayesha Khan");
    await expect(sheet.getByText("Is there a place in grade 3?")).toBeVisible();
    await sheet.getByRole("button", { name: "Mark responded", exact: true }).click();
    await expect(sheet.getByText("Responded", { exact: true })).toBeVisible();
    expect(submissions.find((entry) => entry.name === "Ayesha Khan")?.status).toBe("responded");

    await page.keyboard.press("Escape");
    await expect(websiteSitePage.inboxRow("Ayesha Khan")).toHaveCount(0);
  });

  test("opens a shared link with a received-date range", async ({
    mockApi,
    websiteSitePage,
    signedIn: _signedIn,
  }) => {
    stubSite(mockApi, { submissions: inbox() });
    await websiteSitePage.gotoInbox("?from=2026-11-01&to=2026-11-30");

    await expect(websiteSitePage.inboxRow("Ayesha Khan")).toBeVisible();
    await expect(websiteSitePage.inboxRow("Prize Desk")).toBeVisible();
    await expect(websiteSitePage.inboxRow("Bilal Ahmed")).toHaveCount(0);
  });
});
