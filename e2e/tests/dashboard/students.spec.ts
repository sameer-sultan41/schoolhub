import { expect, test } from "@/fixtures";
import { buildUser, SCHOOL_ADMIN_PERMISSIONS } from "@/data/factories";
import { buildCampus, buildStudent, schoolOrganizationModule, studentsModule } from "@/mocks";

/**
 * The `/students` directory's add / withdraw journeys, plus a permission-gating check,
 * against a stubbed API.
 *
 * What this proves is the dashboard's half: the dialogs send the right request and the
 * table reflects the response. Whether the server accepts it (validation, §11 domain
 * rules, tenant scoping) is the API's own test suite and the `live` lane's job — the stub
 * here returns whatever it was told to.
 */

const campuses = [buildCampus({ id: "campus-0001", name: "Main Campus" })];

test.describe("students directory", () => {
  test.use({
    authUser: buildUser({
      permissions: [
        ...SCHOOL_ADMIN_PERMISSIONS,
        "students.student.create",
        "students.student.update",
        "students.student.withdraw",
      ],
    }),
  });

  test.beforeEach(async ({ signedIn: _signedIn, mockApi, studentsPage }) => {
    mockApi.use(
      schoolOrganizationModule({ campuses, houses: [] }),
      studentsModule({
        students: [buildStudent({ id: "student-0001", first_name: "Ayesha", last_name: "Khan" })],
      }),
    );
    await studentsPage.goto();
  });

  test("adds a student through the creation stepper", async ({ page, studentsPage }) => {
    await studentsPage.addStudentButton.click();
    await page.getByLabel(/first name/i).fill("Bilal");
    await page.getByLabel(/last name/i).fill("Ahmed");
    await page.getByLabel(/date of birth/i).fill("2013-02-14");
    await page.getByRole("combobox", { name: /gender/i }).click();
    await page.getByRole("option", { name: /^male$/i }).click();
    await page.getByRole("combobox", { name: /^campus$/i }).click();
    await page.getByRole("option", { name: "Main Campus" }).click();
    await page.getByLabel(/admission date/i).fill("2026-03-01");

    const request = page.waitForRequest(
      (r) => r.url().includes("/students") && r.method() === "POST",
    );
    // This permission set grants Profile + Emergency Contacts only (no guardian/
    // document/enrollment create permission) — Profile's own submit button reads
    // "Next" since a later step exists.
    await page.getByRole("button", { name: /^next$/i }).click();

    expect((await request).postDataJSON()).toMatchObject({
      first_name: "Bilal",
      last_name: "Ahmed",
      date_of_birth: "2013-02-14",
      gender: "male",
      campus_id: "campus-0001",
      admission_date: "2026-03-01",
    });

    // Now on Emergency Contacts, the wizard's last step for this permission set —
    // closing here is a supported exit, not an abandoned operation.
    await page.getByRole("button", { name: /^finish$/i }).click();
    await expect(studentsPage.row("Bilal Ahmed")).toBeVisible();
  });

  test("withdraws a student, and the row leaves the (active-filtered) default view", async ({
    page,
    studentsPage,
  }) => {
    const request = page.waitForRequest((r) => r.url().includes("student-0001:withdraw"));
    await studentsPage.rowAction("Ayesha Khan", "Withdraw").click();
    await page.getByLabel(/reason/i).fill("Relocated to another city");
    await page.getByLabel(/effective date/i).fill("2026-03-15");
    await page.getByRole("button", { name: /^withdraw$/i }).click();

    expect((await request).postDataJSON()).toMatchObject({
      reason: "Relocated to another city",
      effective_date: "2026-03-15",
    });
    // The directory defaults to status=active — a withdrawn student drops out of it,
    // exactly as a resigned staff member drops out of /staff's own default filter.
    await expect(studentsPage.row("Ayesha Khan")).toHaveCount(0);
    // Switch the status filter to see it withdrawn, and confirm the action is gone there too.
    // Popover + checkbox, matching /staff's own Status filter — not a <select>. The
    // filter trigger's accessible name is "Filter by status", not the visible "Status"
    // text — that bare name is already the Status column's own sort button.
    await page.getByRole("button", { name: /filter by status/i }).click();
    await page.getByRole("checkbox", { name: /^all$/i }).click();
    await expect(studentsPage.row("Ayesha Khan").getByText(/withdrawn/i)).toBeVisible();
    await expect(studentsPage.rowAction("Ayesha Khan", "Withdraw")).toHaveCount(0);
  });
});

test.describe("students directory, view-only permissions", () => {
  // SCHOOL_ADMIN_PERMISSIONS holds only `students.student.view` by default — confirmed
  // against e2e/src/data/factories.ts before writing this.
  test.use({ authUser: buildUser({ permissions: SCHOOL_ADMIN_PERMISSIONS }) });

  test("hides the withdraw action entirely for a user without the permission", async ({
    signedIn: _signedIn,
    mockApi,
    studentsPage,
  }) => {
    mockApi.use(
      schoolOrganizationModule({ campuses, houses: [] }),
      studentsModule({
        students: [buildStudent({ id: "student-0001", first_name: "Ayesha", last_name: "Khan" })],
      }),
    );
    await studentsPage.goto();
    await expect(studentsPage.row("Ayesha Khan")).toBeVisible();
    await expect(studentsPage.rowAction("Ayesha Khan", "Withdraw")).toHaveCount(0);
  });
});
