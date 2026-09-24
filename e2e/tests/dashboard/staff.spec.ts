import { expect, test } from "@/fixtures";
import {
  buildCampus,
  buildDesignation,
  buildStaff,
  schoolOrganizationModule,
  staffModule,
} from "@/mocks";

/**
 * The `/staff` directory's add / edit / exit journeys, against a stubbed API.
 *
 * What this proves is the dashboard's half: the dialogs send the right request and the
 * table reflects the response. Whether the server accepts it (validation, §11 domain
 * rules, tenant scoping) is the API's own test suite and the `live` lane's job — the stub
 * here returns whatever it was told to.
 */

const campus = buildCampus({ id: "campus-main", name: "Main Campus" });
const designation = buildDesignation({ id: "designation-teacher", name: "Teacher" });

const PHOTO_URL = "https://storage.e2e.test/tenants/e2e/staff.photo/ayesha.png";
// A 1×1 PNG — enough for Chromium to decode and report a natural width.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function directory() {
  return [
    buildStaff({
      id: "staff-ayesha",
      first_name: "Ayesha",
      last_name: "Khan",
      campus_id: campus.id,
      campus_name: campus.name,
      designation_id: designation.id,
      designation_name: designation.name,
      phone: "+92-300-1111111",
      photo_url: PHOTO_URL,
    }),
    buildStaff({
      id: "staff-bilal",
      first_name: "Bilal",
      last_name: "Ahmed",
      campus_id: campus.id,
      campus_name: campus.name,
      staff_type: "non_teaching",
      phone: "+92-300-2222222",
    }),
  ];
}

test.describe("staff directory", () => {
  test.beforeEach(async ({ page, mockApi, signedIn: _signedIn, staffPage }) => {
    // Registered after `signedIn`'s dashboard-home stubs, so these `/staff` and
    // `/campuses` handlers win (MockApi prefers the most recently registered route).
    mockApi.use(
      schoolOrganizationModule({ campuses: [campus] }),
      staffModule({ staff: directory(), designations: [designation] }),
    );
    // Storage is not the API, so MockApi never sees the photo request — serve it here.
    await page.route(PHOTO_URL, (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 }),
    );
    await staffPage.goto();
    await expect(staffPage.row("Ayesha Khan")).toBeVisible();
  });

  test("adds a staff member and shows them in the directory", async ({ page, staffPage }) => {
    await staffPage.addMemberButton.click();
    await expect(staffPage.formDialog).toHaveAccessibleName("Add staff member");

    await staffPage.fillRequiredFields({
      firstName: "Zara",
      lastName: "Hussain",
      staffType: "Teaching",
      campus: "Main Campus",
      joiningDate: "2026-09-01",
      phone: "+92-300-3333333",
    });
    await staffPage.chooseOption("Designation", "Teacher");

    const create = page.waitForRequest(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname.endsWith("/staff"),
    );
    await staffPage.addSubmit.click();

    expect((await create).postDataJSON()).toEqual({
      first_name: "Zara",
      last_name: "Hussain",
      staff_type: "teaching",
      campus_id: campus.id,
      designation_id: designation.id,
      joining_date: "2026-09-01",
      phone: "+92-300-3333333",
    });
    await expect(page.getByText("Staff member added")).toBeVisible();
    await expect(staffPage.formDialog).toBeHidden();
    await expect(staffPage.row("Zara Hussain")).toBeVisible();
  });

  test("edits a staff member from a pre-filled form", async ({ page, staffPage }) => {
    await staffPage.rowAction("Ayesha Khan", "Edit");
    await expect(staffPage.formDialog).toHaveAccessibleName("Edit staff member");

    // Every field comes from the fetched record — including the two required selects,
    // which used to come up blank (Radix Select read its not-yet-populated native
    // <select> back as "") and made Save fail validation.
    await expect(staffPage.field("First name")).toHaveValue("Ayesha");
    await expect(staffPage.select("Staff type")).toHaveText("Teaching");
    await expect(staffPage.select("Campus")).toHaveText("Main Campus");
    await expect(staffPage.select("Designation")).toHaveText("Teacher");

    await staffPage.field("Last name").fill("Siddiqui");
    await staffPage.field("Phone").fill("+92-300-9999999");

    const update = page.waitForRequest(
      (request) =>
        request.method() === "PATCH" &&
        new URL(request.url()).pathname.endsWith("/staff/staff-ayesha"),
    );
    await staffPage.saveChanges.click();

    expect((await update).postDataJSON()).toMatchObject({
      first_name: "Ayesha",
      last_name: "Siddiqui",
      phone: "+92-300-9999999",
      staff_type: "teaching",
      campus_id: campus.id,
      designation_id: designation.id,
    });
    await expect(page.getByText("Staff member updated")).toBeVisible();
    await expect(staffPage.formDialog).toBeHidden();
    await expect(staffPage.row("Ayesha Siddiqui")).toBeVisible();
    await expect(staffPage.row("Ayesha Khan")).toHaveCount(0);
  });

  test("exits (deletes) a staff member, who then leaves the active directory", async ({
    page,
    staffPage,
  }) => {
    await staffPage.rowAction("Bilal Ahmed", "Delete");
    await expect(staffPage.exitDialog).toHaveAccessibleName("Exit staff member");

    await staffPage.exitField("Exit date").fill("2026-09-10");
    await staffPage.exitField("Exit reason").fill("Relocated to another city");

    const exit = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname.endsWith("/staff/staff-bilal:exit"),
    );
    await staffPage.confirmExit.click();

    expect((await exit).postDataJSON()).toEqual({
      exit_date: "2026-09-10",
      exit_reason: "Relocated to another city",
    });
    await expect(page.getByText("Staff member exited")).toBeVisible();
    await expect(staffPage.exitDialog).toBeHidden();
    // The directory defaults to the "Active Users" filter, so an exited member drops out
    // of it on the refetch — and nobody else does.
    await expect(staffPage.row("Bilal Ahmed")).toHaveCount(0);
    await expect(staffPage.row("Ayesha Khan")).toBeVisible();
  });

  test("shows a staff member's photo, and initials for one without", async ({ staffPage }) => {
    const photo = staffPage.rowPhoto("Ayesha Khan");
    await expect(photo).toHaveAttribute("src", PHOTO_URL);
    await expect
      .poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBe(1);

    await expect(staffPage.rowPhoto("Bilal Ahmed")).toHaveCount(0);
    await expect(staffPage.row("Bilal Ahmed").getByText("BA")).toBeVisible();
  });
});
