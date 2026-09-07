import { buildCampus, buildStaff, schoolOrganizationModule, staffModule } from "@/mocks";
import { expect, test } from "@/fixtures";

const CAMPUS = buildCampus({ id: "campus-main", name: "North Campus" });

test.describe("staff list", () => {
  test("shows the translated empty state when there is no staff", async ({
    page,
    mockApi,
    staffPage,
    signedIn: _signedIn,
  }) => {
    mockApi.use(schoolOrganizationModule({ campuses: [CAMPUS] }), staffModule({ staff: [] }));
    await staffPage.goto();

    await expect(staffPage.table).toBeVisible();
    await expect(page.getByText("No staff yet")).toBeVisible();
    await expect(
      page.getByText("Add your first staff member, or import the list you already keep."),
    ).toBeVisible();
  });

  test("lists an existing staff member and navigates to their detail page", async ({
    page,
    mockApi,
    staffPage,
    signedIn: _signedIn,
  }) => {
    const member = buildStaff({
      id: "staff-0001",
      first_name: "Bilal",
      last_name: "Ahmed",
      employee_number: "EMP-0001",
      campus_id: CAMPUS.id,
    });
    mockApi.use(schoolOrganizationModule({ campuses: [CAMPUS] }), staffModule({ staff: [member] }));
    await staffPage.goto();

    const row = staffPage.row("Bilal Ahmed");
    await expect(row).toBeVisible();
    await expect(row).toContainText("EMP-0001");

    await row.click();
    await expect(page.getByRole("heading", { name: "Bilal Ahmed" })).toBeVisible();
    await expect(page.getByText("EMP-0001")).toBeVisible();
  });

  // Confirms staffPage.searchInput's getByLabel locator actually resolves against the
  // real page — the search field is a plain `<label htmlFor>`, not a FormField, so it
  // doesn't hit the aria-hidden-required-marker gotcha the form fields below do, but
  // that's a claim about the DOM worth checking live rather than trusting by inspection.
  // The debounced re-fetch itself is already covered by students-table.test.tsx's Jest
  // equivalent; this only proves the locator finds the real input and it accepts text.
  test("the search field is reachable by its accessible label", async ({
    mockApi,
    staffPage,
    signedIn: _signedIn,
  }) => {
    mockApi.use(schoolOrganizationModule({ campuses: [CAMPUS] }), staffModule({ staff: [] }));
    await staffPage.goto();

    await staffPage.searchInput.fill("Bilal");
    await expect(staffPage.searchInput).toHaveValue("Bilal");
  });
});

test.describe("the table's own controls", () => {
  // Twelve members over a page size of ten: enough for a second page and no more, so
  // the window never elides and every assertion below is about the pager rather than
  // about `getPageNumbers`, which has its own unit tests.
  const TWELVE = Array.from({ length: 12 }, (_, index) =>
    buildStaff({
      id: `staff-${String(index + 1).padStart(4, "0")}`,
      first_name: ["Amina", "Bilal", "Iqra"][index % 3] ?? "Amina",
      last_name: ["Qureshi", "Sethi", "Raza"][index % 3] ?? "Qureshi",
      employee_number: `EMP-${String(index + 1).padStart(4, "0")}`,
      campus_id: CAMPUS.id,
    }),
  );

  test("pages by number, and the page survives a reload", async ({
    page,
    mockApi,
    staffPage,
    signedIn: _signedIn,
  }) => {
    mockApi.use(schoolOrganizationModule({ campuses: [CAMPUS] }), staffModule({ staff: TWELVE }));
    await staffPage.goto({ path: "/staff?page_size=10" });

    await expect(staffPage.pageButton(1)).toHaveAttribute("aria-current", "page");
    await expect(staffPage.previousPage).toBeDisabled();
    // Ten of twelve: the tenth row is on this page, the eleventh is not.
    await expect(staffPage.row("EMP-0010")).toBeVisible();
    await expect(staffPage.row("EMP-0011")).toHaveCount(0);

    await staffPage.pageButton(2).click();

    await expect(staffPage.row("EMP-0011")).toBeVisible();
    await expect(staffPage.row("EMP-0010")).toHaveCount(0);
    await expect(staffPage.pageButton(2)).toHaveAttribute("aria-current", "page");
    await expect(staffPage.nextPage).toBeDisabled();

    // The page is in the URL, which is the whole reason it is not in React state: a
    // colleague sent this link, or the reader pressed refresh, and either way they
    // land where they were.
    await page.reload();
    await expect(staffPage.row("EMP-0011")).toBeVisible();
  });

  test("sorting returns to the first page", async ({ mockApi, staffPage, signedIn: _signedIn }) => {
    mockApi.use(schoolOrganizationModule({ campuses: [CAMPUS] }), staffModule({ staff: TWELVE }));
    await staffPage.goto({ path: "/staff?page_size=10&page=2" });

    await expect(staffPage.row("EMP-0011")).toBeVisible();

    await staffPage.sortBy("Name").click();

    // Staying on page 2 of a re-sorted list shows rows the reader did not ask for, and
    // on a shorter list shows nothing at all.
    await expect(staffPage.pageButton(1)).toHaveAttribute("aria-current", "page");
  });

  test("a hidden column stays hidden across a reload", async ({
    page,
    mockApi,
    staffPage,
    signedIn: _signedIn,
  }) => {
    mockApi.use(schoolOrganizationModule({ campuses: [CAMPUS] }), staffModule({ staff: TWELVE }));
    await staffPage.goto();

    const before = await staffPage.columnHeaders.count();
    await expect(staffPage.columnHeaders.filter({ hasText: "Department" })).toBeVisible();

    await staffPage.columnsMenuTrigger.click();
    // Two toggles without reopening: the menu stays open on purpose, because choosing
    // which columns to see is a comparison rather than a single choice.
    await staffPage.columnToggle("Department").click();
    await staffPage.columnToggle("Designation").click();
    await page.keyboard.press("Escape");

    await expect(staffPage.columnHeaders).toHaveCount(before - 2);
    await expect(staffPage.columnHeaders.filter({ hasText: "Department" })).toHaveCount(0);

    await page.reload();
    await expect(staffPage.columnHeaders).toHaveCount(before - 2);
  });
});

test.describe("creating a staff member", () => {
  test("submits the required fields and lands on the new record's detail page", async ({
    page,
    mockApi,
    staffPage,
    signedIn: _signedIn,
  }) => {
    mockApi.use(schoolOrganizationModule({ campuses: [CAMPUS] }), staffModule({ staff: [] }));
    await staffPage.goto({ path: "/staff/new" });

    await expect(page.getByRole("heading", { name: "New staff member" })).toBeVisible();

    await staffPage.fillRequiredFields({
      firstName: "Sana",
      lastName: "Khan",
      phone: "+92 300 9998888",
      joiningDate: "2026-05-01",
      campus: "North Campus",
    });
    await staffPage.submit.click();

    await expect(page.getByRole("heading", { name: "Sana Khan" })).toBeVisible();
    expect(mockApi.countCalls("POST", "/staff")).toBe(1);
  });

  // 🔍 probe: the happy path above proves the form works; this proves the form
  // actually enforces its own required field client-side rather than relying
  // solely on the server, per non-functional.md's instant-feedback rule.
  test("blocks submission and never calls the API when the campus is left unselected", async ({
    page,
    mockApi,
    staffPage,
    signedIn: _signedIn,
  }) => {
    mockApi.use(schoolOrganizationModule({ campuses: [CAMPUS] }), staffModule({ staff: [] }));
    await staffPage.goto({ path: "/staff/new" });

    await staffPage.firstName.fill("Sana");
    await staffPage.lastName.fill("Khan");
    await staffPage.phone.fill("+92 300 9998888");
    await staffPage.joiningDate.fill("2026-05-01");
    // Campus deliberately left at its placeholder value.
    await staffPage.submit.click();

    // Still on the create form — no navigation happened.
    await expect(page.getByRole("heading", { name: "New staff member" })).toBeVisible();
    expect(mockApi.countCalls("POST", "/staff")).toBe(0);
  });
});
