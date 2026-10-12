import { expect, test } from "@/fixtures";
import { ORG_IDS } from "@/data/factories";
import { API_PATH_PREFIX, env } from "@/env";
import {
  buildCampus,
  buildStaff,
  buildStudent,
  schoolOrganizationModule,
  staffModule,
  studentsModule,
} from "@/mocks";

/**
 * `/students` and `/staff` keep their list view (search, filters, sort, page, page size,
 * hidden columns) in the query string, so a reload or a shared link shows the same list
 * (ADR-0024).
 *
 * What this proves is the dashboard's half: the address carries the view, and the same
 * address asks the API for the same list. Whether the API filters and pages correctly is
 * its own test suite's job; the stubs here return whatever they were told to.
 */

const API_ORIGIN = new URL(env.API_BASE_URL).origin;
/** The toolbar headcounts ask for one row each; the directory never does. */
const HEADCOUNT_PAGE_SIZE = "1";

/** Whether `request` is the directory's own list fetch for `path` (`/students`, `/staff`). */
function isListRequest(request: { method(): string; url(): string }, path: string): boolean {
  const url = new URL(request.url());
  return (
    request.method() === "GET" &&
    url.origin === API_ORIGIN &&
    url.pathname === `${API_PATH_PREFIX}${path}` &&
    url.searchParams.get("page_size") !== HEADCOUNT_PAGE_SIZE
  );
}

function queryOf(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams);
}

test.describe("students directory, list state in the URL", () => {
  const campuses = [
    buildCampus({ id: ORG_IDS.mainCampus, name: "Main Campus" }),
    buildCampus({ id: ORG_IDS.northCampus, name: "North Campus", is_primary: false }),
  ];
  const students = [
    buildStudent({ first_name: "Ayesha", last_name: "Khan", admission_date: "2026-01-10" }),
    buildStudent({ first_name: "Bilal", last_name: "Ahmed", admission_date: "2026-02-15" }),
    buildStudent({
      first_name: "Zainab",
      last_name: "Malik",
      campus_id: ORG_IDS.northCampus,
      campus_name: "North Campus",
    }),
  ];

  test.beforeEach(({ signedIn: _signedIn, mockApi }) => {
    mockApi.use(schoolOrganizationModule({ campuses, houses: [] }), studentsModule({ students }));
  });

  test("a reload keeps the campus filter, the sort and the request", async ({
    page,
    studentsPage,
  }) => {
    await studentsPage.goto();
    await expect(studentsPage.row("Zainab Malik")).toBeVisible();

    const campusFilter = page.getByRole("combobox", { name: "Campus", exact: true });
    await campusFilter.click();
    await page.getByRole("option", { name: "Main Campus", exact: true }).click();
    await expect(studentsPage.row("Zainab Malik")).toHaveCount(0);

    const sorted = page.waitForRequest(
      (request) => isListRequest(request, "/students") && "ordering" in queryOf(request.url()),
    );
    // The header button is a menu trigger; sort through its menu item, which closes the menu.
    await page.getByRole("button", { name: "Admitted", exact: true }).click();
    await page.getByRole("menuitem", { name: "Sort Admitted ascending" }).click();
    const before = queryOf((await sorted).url());
    expect(before).toMatchObject({ campus_id: ORG_IDS.mainCampus, ordering: "admission_date" });
    await expect
      .poll(() => queryOf(page.url()))
      .toEqual({ campus: ORG_IDS.mainCampus, sort: "admissionDate" });

    const reloaded = page.waitForRequest((request) => isListRequest(request, "/students"));
    await page.reload();

    expect(queryOf((await reloaded).url())).toEqual(before);
    await expect(campusFilter).toContainText("Main Campus");
    await expect(studentsPage.row("Ayesha Khan")).toBeVisible();
    await expect(studentsPage.row("Zainab Malik")).toHaveCount(0);
  });

  test("a link to a page past the end lands on page 1, with `page` dropped", async ({
    page,
    studentsPage,
  }) => {
    const stale = page.waitForResponse(
      (response) =>
        isListRequest(response.request(), "/students") && queryOf(response.url())["page"] === "9",
    );
    await studentsPage.goto({ path: "/students?page=9" });

    expect((await stale).status()).toBe(404);
    await expect(page).toHaveURL(/\/students$/);
    await expect(studentsPage.row("Ayesha Khan")).toBeVisible();
  });
});

test.describe("staff directory, list state in the URL", () => {
  const staff = [
    buildStaff({ first_name: "Ayesha", last_name: "Khan", joining_date: "2026-04-01" }),
    buildStaff({ first_name: "Bilal", last_name: "Ahmed", joining_date: "2025-08-01" }),
    buildStaff({
      first_name: "Imran",
      last_name: "Raza",
      joining_date: "2024-01-15",
      employment_status: "resigned",
      exit_date: "2026-06-30",
    }),
  ];

  test.beforeEach(({ signedIn: _signedIn, mockApi }) => {
    mockApi.use(schoolOrganizationModule(), staffModule({ staff }));
  });

  test("a reload keeps Active Users off and the Sort Order preset, and the request", async ({
    page,
    staffPage,
  }) => {
    await staffPage.goto();
    await expect(staffPage.row("Ayesha Khan")).toBeVisible();
    await expect(staffPage.row("Imran Raza")).toHaveCount(0);

    const activeUsers = page.getByRole("switch", { name: "Active Users" });
    await activeUsers.click();
    await expect(staffPage.row("Imran Raza")).toBeVisible();

    const sorted = page.waitForRequest(
      (request) =>
        isListRequest(request, "/staff") && queryOf(request.url())["ordering"] === "-joining_date",
    );
    const sortOrder = page.getByRole("button", { name: /^Sort Order/ });
    await sortOrder.click();
    await page.getByRole("checkbox", { name: "Newest joiners" }).click();
    await page.keyboard.press("Escape");
    const before = queryOf((await sorted).url());
    // Active Users off is "no status filter", not a status of its own.
    expect(before).not.toHaveProperty("employment_status");
    await expect.poll(() => queryOf(page.url())).toEqual({ status: "all", sort: "-joiningDate" });

    const reloaded = page.waitForRequest((request) => isListRequest(request, "/staff"));
    await page.reload();

    expect(queryOf((await reloaded).url())).toEqual(before);
    await expect(activeUsers).not.toBeChecked();
    await expect(sortOrder).toContainText("Newest joiners");
    await expect(staffPage.row("Imran Raza")).toBeVisible();
  });
});
