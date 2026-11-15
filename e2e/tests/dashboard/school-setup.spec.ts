import { expect, test } from "@/fixtures";
import {
  buildUser,
  ORG_IDS,
  SCHOOL_ADMIN_PERMISSIONS,
  SCHOOL_SETUP_PERMISSIONS,
} from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  buildCampus,
  buildDepartment,
  buildHolidayCalendar,
  buildHouse,
  type MockApi,
  schoolOrganizationModule,
} from "@/mocks";

/**
 * The School module, `/school/*`, against a stubbed API: the sidebar and tabs gate on the
 * viewer's write keys, each section's dialogs send the right request, and the list reflects
 * the response. Whether the server accepts a write is the API suite's job; the stub mirrors
 * only the refusals the screens surface (a campus still in use, a holiday ending before it
 * starts).
 */

const mainCampus = buildCampus({ id: ORG_IDS.mainCampus, name: "Main Campus", code: "MAIN" });
const northCampus = buildCampus({
  id: ORG_IDS.northCampus,
  name: "North Campus",
  code: "NORTH",
  is_primary: false,
});

const eid = {
  name: "Spring break",
  start_date: "2027-03-20",
  end_date: "2027-03-22",
  campus_id: null,
};

const schoolAdmin = buildUser({
  permissions: [...SCHOOL_ADMIN_PERMISSIONS, ...SCHOOL_SETUP_PERMISSIONS],
});

function stubSchool(mockApi: MockApi) {
  mockApi.use(
    schoolOrganizationModule({
      campuses: [mainCampus, northCampus],
      // Science sits on the main campus, so that campus is still in use.
      departments: [buildDepartment({ name: "Science", code: "SCI", campus_id: mainCampus.id })],
      houses: [buildHouse({ name: "Red House", code: "RED", color: "#D32F2F" })],
      calendar: buildHolidayCalendar({ holidays: [eid] }),
    }),
  );
}

test.describe("school sidebar group", () => {
  test.describe("with the setup keys", () => {
    test.use({ authUser: schoolAdmin });

    test("lists the five sections and opens one", async ({
      page,
      mockApi,
      dashboardPage,
      schoolSetupPage,
      signedIn: _signedIn,
    }) => {
      stubSchool(mockApi);
      await dashboardPage.goto();

      await dashboardPage.navGroup("School").click();
      for (const section of ["Profile & settings", "Departments", "Houses", "Calendar"]) {
        await expect(dashboardPage.navLink(section)).toBeVisible();
      }
      await dashboardPage.navLink("Campuses").click();

      await expect(page).toHaveURL(/\/school\/campuses$/);
      await expect(schoolSetupPage.tab("Campuses")).toHaveAttribute("aria-current", "page");
    });
  });

  test.describe("with only the view keys", () => {
    // Every staff role holds the `.view` keys; the setup screens are for the write keys.
    test.use({
      authUser: buildUser({
        permissions: [...SCHOOL_ADMIN_PERMISSIONS, "school.settings.view", "school.campus.view"],
      }),
    });

    test("shows no School group", async ({ dashboardPage, signedIn: _signedIn }) => {
      await dashboardPage.goto();

      // The sidebar has drawn the viewer's modules before the absence is asserted.
      await expect(dashboardPage.navLink("Students")).toBeVisible();
      await expect(dashboardPage.navGroup("School")).toHaveCount(0);
    });
  });
});

test.describe("school sections", () => {
  test.use({ authUser: schoolAdmin });

  test.beforeEach(({ signedIn: _signedIn, mockApi }) => {
    stubSchool(mockApi);
  });

  test("the module root lands on the first section", async ({ page, schoolSetupPage }) => {
    await schoolSetupPage.goto();

    await expect(page).toHaveURL(/\/school\/profile$/);
  });

  test("adds a campus", async ({ page, schoolSetupPage }) => {
    await schoolSetupPage.open("Campuses");
    await schoolSetupPage.addButton("Add campus").click();
    await schoolSetupPage.field("Name").fill("South Campus");
    await schoolSetupPage.field("Code").fill("SOUTH");

    const request = page.waitForRequest((r) => isApiCall(r, "POST", /\/campuses$/));
    await schoolSetupPage.saveButton.click();

    expect((await request).postDataJSON()).toEqual({
      name: "South Campus",
      code: "SOUTH",
      phone: null,
      email: null,
      timezone: null,
      is_primary: false,
      is_active: true,
    });
    await expect(schoolSetupPage.formDialog).toBeHidden();
    await expect(schoolSetupPage.row("South Campus")).toBeVisible();
  });

  test("keeps a campus still in use, saying why, and removes one that is not", async ({
    schoolSetupPage,
  }) => {
    await schoolSetupPage.open("Campuses");

    await schoolSetupPage.rowAction("Main Campus", "Remove").click();
    await schoolSetupPage.confirmRemove.click();
    await expect(schoolSetupPage.removeDialog).toContainText(
      "Cannot delete while dependent records exist (departments). Deactivate it instead.",
    );
    await schoolSetupPage.removeDialog.getByRole("button", { name: "Cancel" }).click();

    await schoolSetupPage.rowAction("North Campus", "Remove").click();
    await schoolSetupPage.confirmRemove.click();
    await expect(schoolSetupPage.row("North Campus")).toHaveCount(0);
    await expect(schoolSetupPage.row("Main Campus")).toBeVisible();
  });

  test("adds a department for every campus", async ({ page, schoolSetupPage }) => {
    await schoolSetupPage.open("Departments");
    await expect(schoolSetupPage.row("Science")).toContainText("Main Campus");
    await schoolSetupPage.addButton("Add department").click();
    await schoolSetupPage.field("Name").fill("Accounts");
    await schoolSetupPage.field("Code").fill("ACC");
    await schoolSetupPage.formSelect("Type").click();
    await schoolSetupPage.option("Administrative").click();

    const request = page.waitForRequest((r) => isApiCall(r, "POST", /\/departments$/));
    await schoolSetupPage.saveButton.click();

    expect((await request).postDataJSON()).toMatchObject({
      name: "Accounts",
      department_type: "administrative",
      campus_id: null,
    });
    await expect(schoolSetupPage.row("Accounts")).toContainText("All campuses");
  });

  test("recolours a house", async ({ page, schoolSetupPage }) => {
    await schoolSetupPage.open("Houses");
    await schoolSetupPage.rowAction("Red House", "Edit").click();
    await schoolSetupPage.field("Colour").fill("#B71C1C");

    const request = page.waitForRequest((r) => isApiCall(r, "PATCH", /\/houses\/[^/]+$/));
    await schoolSetupPage.saveButton.click();

    expect((await request).postDataJSON()).toMatchObject({ name: "Red House", color: "#B71C1C" });
    await expect(schoolSetupPage.row("Red House")).toContainText("#B71C1C");
  });

  test("renames the school and sets its colour, merging the branding", async ({
    page,
    schoolSetupPage,
  }) => {
    await schoolSetupPage.open("Profile & settings");
    await schoolSetupPage.pageField("School name").fill("City School North");
    await schoolSetupPage.pageField("Brand colour").fill("#123ABC");

    const request = page.waitForRequest((r) => isApiCall(r, "PATCH", /\/school-settings$/));
    await schoolSetupPage.button("Save").click();

    expect((await request).postDataJSON()).toEqual({
      name: "City School North",
      branding: { primary_color: "#123ABC" },
      timezone: "Asia/Karachi",
      locale: "en",
      currency: "PKR",
    });
    await expect(schoolSetupPage.button("Save")).toBeDisabled();
    await expect(schoolSetupPage.pageField("School name")).toHaveValue("City School North");
  });

  test("opens Saturdays and adds a one-day holiday", async ({ page, schoolSetupPage }) => {
    await schoolSetupPage.open("Calendar");
    await expect(schoolSetupPage.row("Spring break")).toBeVisible();

    await schoolSetupPage.weekday("Saturday").click();
    const week = page.waitForRequest((r) => isApiCall(r, "PUT", /\/holiday-calendar$/));
    await schoolSetupPage.button("Save working week").click();
    expect((await week).postDataJSON()).toEqual({ working_days: [0, 1, 2, 3, 4, 5] });

    await schoolSetupPage.addButton("Add holiday").click();
    await schoolSetupPage.field("Name").fill("Founders Day");
    await schoolSetupPage.field("First day").fill("2026-12-25");
    const holidays = page.waitForRequest((r) => isApiCall(r, "PUT", /\/holiday-calendar$/));
    await schoolSetupPage.saveButton.click();

    expect((await holidays).postDataJSON()).toEqual({
      holidays: [
        eid,
        { name: "Founders Day", start_date: "2026-12-25", end_date: "2026-12-25", campus_id: null },
      ],
    });
    await expect(schoolSetupPage.row("Founders Day")).toBeVisible();
  });
});
