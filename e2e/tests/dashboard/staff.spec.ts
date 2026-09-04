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
    await expect(page.getByText("No staff found.")).toBeVisible();
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
