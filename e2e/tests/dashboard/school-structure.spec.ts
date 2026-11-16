import { expect, test } from "@/fixtures";
import {
  buildUser,
  ORG_IDS,
  SCHOOL_ADMIN_PERMISSIONS,
  SCHOOL_SETUP_PERMISSIONS,
} from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import { buildCampus, buildDepartment, schoolOrganizationModule } from "@/mocks";

/**
 * The School module's year setup, `/school/sessions`, `/school/classes` and `/school/subjects`,
 * against a stubbed API: a new school adds its session and terms, a class with a section and a
 * subject, then activates the session. The stub keeps what each write sends and mirrors the
 * activation check (`session_completeness_errors`), so a refused activation lists the same gaps
 * the server would. Whether the server enforces them is the API suite's job.
 */

const mainCampus = buildCampus({ id: ORG_IDS.mainCampus, name: "Main Campus", code: "MAIN" });
const science = buildDepartment({ name: "Science", code: "SCI" });

test.use({
  authUser: buildUser({ permissions: [...SCHOOL_ADMIN_PERMISSIONS, ...SCHOOL_SETUP_PERMISSIONS] }),
});

test.beforeEach(({ signedIn: _signedIn, mockApi }) => {
  // A school with its campus and departments, and no year yet.
  mockApi.use(schoolOrganizationModule({ campuses: [mainCampus], departments: [science] }));
});

test("sets up a school year from nothing and activates it", async ({ page, schoolSetupPage }) => {
  await test.step("add the session", async () => {
    await schoolSetupPage.open("Sessions & terms");
    await schoolSetupPage.addButton("Add session").click();
    await schoolSetupPage.field("Name").fill("2027-28");
    await schoolSetupPage.field("Start date").fill("2027-04-01");
    await schoolSetupPage.field("End date").fill("2028-03-31");

    const request = page.waitForRequest((r) => isApiCall(r, "POST", /\/academic-sessions$/));
    await schoolSetupPage.saveButton.click();

    expect((await request).postDataJSON()).toEqual({
      name: "2027-28",
      start_date: "2027-04-01",
      end_date: "2028-03-31",
    });
    await expect(schoolSetupPage.formDialog).toBeHidden();
  });

  await test.step("an early activation lists what is missing", async () => {
    await schoolSetupPage.button("Activate 2027-28").click();
    await schoolSetupPage.alertButton("Activate session").click();

    const gaps = schoolSetupPage.removeDialog.getByRole("listitem");
    await expect(gaps).toHaveText([
      "At least one active class with an active section is required.",
      "At least one term is required.",
    ]);
    await schoolSetupPage.alertButton("Cancel").click();
  });

  await test.step("add two terms that cover the year", async () => {
    await schoolSetupPage.button("Show terms for 2027-28").click();
    const terms = schoolSetupPage.nestedTable("Terms of 2027-28");
    for (const [name, order, start, end] of [
      ["Term 1", "1", "2027-04-01", "2027-09-30"],
      ["Term 2", "2", "2027-10-01", "2028-03-31"],
    ] as const) {
      await schoolSetupPage.addButton("Add term").click();
      await schoolSetupPage.field("Name").fill(name);
      // The order is prefilled after the session's last term.
      await expect(schoolSetupPage.field("Order")).toHaveValue(order);
      await schoolSetupPage.field("Start date").fill(start);
      await schoolSetupPage.field("End date").fill(end);

      const request = page.waitForRequest((r) => isApiCall(r, "POST", /\/terms$/));
      await schoolSetupPage.saveButton.click();
      expect((await request).postDataJSON()).toMatchObject({
        name,
        sequence: Number(order),
        start_date: start,
        end_date: end,
      });
      await expect(schoolSetupPage.formDialog).toBeHidden();
      // Listed before the next Add, whose order is counted from the terms already there.
      await expect(terms.getByRole("row", { name: new RegExp(name) })).toBeVisible();
    }
  });

  await test.step("add a class and its section", async () => {
    await schoolSetupPage.open("Classes & sections");
    await schoolSetupPage.addButton("Add class").click();
    await schoolSetupPage.field("Name").fill("Grade 1");
    await schoolSetupPage.field("Level").fill("1");

    const classRequest = page.waitForRequest((r) => isApiCall(r, "POST", /\/classes$/));
    await schoolSetupPage.saveButton.click();
    expect((await classRequest).postDataJSON()).toEqual({
      name: "Grade 1",
      code: null,
      level: 1,
      is_active: true,
    });
    await expect(schoolSetupPage.formDialog).toBeHidden();

    await schoolSetupPage.button("Show sections for Grade 1").click();
    await schoolSetupPage.addButton("Add section").click();
    await schoolSetupPage.field("Name").fill("A");
    await schoolSetupPage.formSelect("Campus").click();
    await schoolSetupPage.option("Main Campus").click();
    await schoolSetupPage.field("Capacity").fill("30");

    const sectionRequest = page.waitForRequest((r) => isApiCall(r, "POST", /\/sections$/));
    await schoolSetupPage.saveButton.click();
    expect((await sectionRequest).postDataJSON()).toMatchObject({
      campus_id: mainCampus.id,
      name: "A",
      capacity: 30,
      is_active: true,
    });
    await expect(
      schoolSetupPage.nestedTable("Sections of Grade 1").getByRole("row", { name: /Main Campus/ }),
    ).toBeVisible();
  });

  await test.step("add a subject in a department", async () => {
    await schoolSetupPage.open("Subjects");
    await schoolSetupPage.addButton("Add subject").click();
    await schoolSetupPage.field("Name").fill("Mathematics");
    await schoolSetupPage.field("Code").fill("MATH");
    await schoolSetupPage.formSelect("Department").click();
    await schoolSetupPage.option("Science").click();

    const request = page.waitForRequest((r) => isApiCall(r, "POST", /\/subjects$/));
    await schoolSetupPage.saveButton.click();
    expect((await request).postDataJSON()).toEqual({
      name: "Mathematics",
      code: "MATH",
      subject_type: "core",
      department_id: science.id,
      description: null,
      is_active: true,
    });
    await expect(schoolSetupPage.row("Mathematics")).toContainText("Science");
  });

  await test.step("activate the session", async () => {
    await schoolSetupPage.open("Sessions & terms");
    await schoolSetupPage.button("Activate 2027-28").click();

    const request = page.waitForRequest((r) =>
      isApiCall(r, "POST", /\/academic-sessions\/[^/]+:activate$/),
    );
    await schoolSetupPage.alertButton("Activate session").click();
    await request;

    await expect(schoolSetupPage.removeDialog).toBeHidden();
    // Close is offered on the active session only, and Activate on a planned one only.
    await expect(schoolSetupPage.button("Close 2027-28")).toBeVisible();
    await expect(schoolSetupPage.button("Activate 2027-28")).toHaveCount(0);
  });
});
