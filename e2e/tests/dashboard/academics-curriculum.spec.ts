import { expect, test } from "@/fixtures";
import {
  ACADEMICS_CURRICULUM_PERMISSIONS,
  buildUser,
  ORG_IDS,
  SCHOOL_ADMIN_PERMISSIONS,
} from "@/data/factories";
import {
  academicsCurriculumModule,
  buildAcademicSession,
  buildCampus,
  buildCurriculum,
  buildSchoolClass,
  buildSubject,
  type MockApi,
  schoolOrganizationModule,
} from "@/mocks";

/**
 * The Academics sidebar group and the `/academics/curriculum` screen: add, edit, remove and
 * clone, plus the closed-session read-only state, against a stubbed API.
 *
 * What this proves is the dashboard's half: the dialogs send the right request, the table and
 * the URL reflect the response, and the sidebar and toolbar gate on the viewer's keys. Whether
 * the server accepts a write (the session lock, §11's identity and elective rules, tenant
 * scoping) is the API's own test suite and the `live` lane's job; the stub returns whatever it
 * was told to.
 */

const closedSession = buildAcademicSession({
  name: "2025-26",
  status: "closed",
  is_current: false,
});
const currentSession = buildAcademicSession({ id: ORG_IDS.currentSession, name: "2026-27" });
const nextSession = buildAcademicSession({
  name: "2027-28",
  status: "planned",
  is_current: false,
});
const sessions = [closedSession, currentSession, nextSession];

const campuses = [buildCampus({ id: ORG_IDS.mainCampus, name: "Main Campus" })];
const classes = [buildSchoolClass({ id: ORG_IDS.grade1, name: "Grade 1" })];
const mathematics = buildSubject({ name: "Mathematics" });
const english = buildSubject({ name: "English" });
const science = buildSubject({ name: "Science" });
const subjects = [mathematics, english, science];

const schoolAdmin = buildUser({
  permissions: [...SCHOOL_ADMIN_PERMISSIONS, ...ACADEMICS_CURRICULUM_PERMISSIONS],
});

const COLLECTION_PATH = /\/class-subjects$/;
const ROW_PATH = /\/class-subjects\/[^/]+$/;
const CLONE_PATH = /\/class-subjects:clone$/;

/** Whether `request` is a `method` call to a `/class-subjects` path matching `path`. */
function isCurriculumCall(
  request: { method(): string; url(): string },
  method: string,
  path: RegExp,
): boolean {
  return request.method() === method && path.test(new URL(request.url()).pathname);
}

/** Fresh rows per test: a PATCH mutates the row objects the stub holds. */
function buildRows() {
  return [
    buildCurriculum({
      subject_id: mathematics.id,
      subject_name: "Mathematics",
      weekly_periods: 5,
    }),
    buildCurriculum({ subject_id: english.id, subject_name: "English", weekly_periods: 4 }),
    // The next session already maps Mathematics, so a clone into it skips that row.
    buildCurriculum({
      academic_session_id: nextSession.id,
      academic_session_name: "2027-28",
      subject_id: mathematics.id,
      subject_name: "Mathematics",
      weekly_periods: 3,
    }),
  ];
}

/** Stubs what the screen reads: the reference lists and the curriculum rows. */
function stubCurriculumApi(mockApi: MockApi, rows = buildRows()) {
  mockApi.use(
    schoolOrganizationModule({ campuses, classes, subjects, academicSessions: sessions }),
    academicsCurriculumModule({ rows, sessions, classes, subjects, campuses }),
  );
}

test.describe("academics sidebar group", () => {
  test.describe("with the curriculum keys", () => {
    test.use({ authUser: schoolAdmin });

    test("lists Curriculum under Academics and opens the screen", async ({
      page,
      mockApi,
      dashboardPage,
      curriculumPage,
      signedIn: _signedIn,
    }) => {
      stubCurriculumApi(mockApi);
      await dashboardPage.goto();

      // Closed until clicked: a child is out of the DOM until its group opens.
      await dashboardPage.navGroup("Academics").click();
      await expect(dashboardPage.navLink("Curriculum")).toBeVisible();
      await dashboardPage.navLink("Curriculum").click();

      await expect(page).toHaveURL(/\/academics\/curriculum$/);
      await expect(curriculumPage.heading).toHaveText("Curriculum");
    });
  });

  test.describe("without an academics key", () => {
    test("is hidden", async ({ dashboardPage, signedIn: _signedIn }) => {
      await dashboardPage.goto();

      // A link the default admin does hold, so the menu is known to be filtered for the
      // loaded user before the group's absence is asserted.
      await expect(dashboardPage.navLink("Students")).toBeVisible();
      await expect(dashboardPage.navGroup("Academics")).toHaveCount(0);
    });
  });

  test.describe("with an academics key that opens no section", () => {
    // The module key is held, but Curriculum needs `.view`; with no child left, the group goes.
    test.use({
      authUser: buildUser({
        permissions: [...SCHOOL_ADMIN_PERMISSIONS, "academics.curriculum.export"],
      }),
    });

    test("is hidden", async ({ dashboardPage, signedIn: _signedIn }) => {
      await dashboardPage.goto();

      await expect(dashboardPage.navLink("Students")).toBeVisible();
      await expect(dashboardPage.navGroup("Academics")).toHaveCount(0);
    });
  });
});

test.describe("curriculum screen", () => {
  test.use({ authUser: schoolAdmin });

  test.beforeEach(async ({ signedIn: _signedIn, mockApi, curriculumPage }) => {
    stubCurriculumApi(mockApi);
    // No `session` in the URL, so this is the current session: Mathematics and English.
    await curriculumPage.goto();
    await expect(curriculumPage.row("Mathematics")).toBeVisible();
  });

  test("adds a subject to a class", async ({ page, curriculumPage }) => {
    await curriculumPage.addSubjectButton.click();
    await curriculumPage.chooseOption(curriculumPage.formSelect("Class"), "Grade 1");
    await curriculumPage.chooseOption(curriculumPage.formSelect("Subject"), "Science");
    await curriculumPage.weeklyPeriodsInput.fill("4");

    const request = page.waitForRequest((r) => isCurriculumCall(r, "POST", COLLECTION_PATH));
    await curriculumPage.saveButton.click();

    // The session is the screen's, and Campus is left on "All campuses", which goes as null.
    expect((await request).postDataJSON()).toEqual({
      academic_session_id: currentSession.id,
      class_id: ORG_IDS.grade1,
      subject_id: science.id,
      campus_id: null,
      is_elective: false,
      elective_group: null,
      weekly_periods: 4,
      notes: null,
    });
    await expect(page.getByText("Curriculum mapping saved.")).toBeVisible();
    await expect(curriculumPage.formDialog).toBeHidden();
    await expect(curriculumPage.row("Science")).toBeVisible();
  });

  test("edits the weekly periods and sends only the fields a mapping may change", async ({
    page,
    curriculumPage,
  }) => {
    await curriculumPage.rowAction("Mathematics", "Grade 1", "Edit").click();
    await expect(curriculumPage.formDialog).toHaveAccessibleName("Edit curriculum mapping");
    // Session, class, subject and campus identify the mapping, so the form shows them
    // read-only.
    await expect(curriculumPage.formSelect("Class")).toBeDisabled();
    await expect(curriculumPage.weeklyPeriodsInput).toHaveValue("5");
    await curriculumPage.weeklyPeriodsInput.fill("6");

    const request = page.waitForRequest((r) => isCurriculumCall(r, "PATCH", ROW_PATH));
    await curriculumPage.saveButton.click();

    expect((await request).postDataJSON()).toEqual({
      is_elective: false,
      elective_group: null,
      weekly_periods: 6,
      notes: null,
    });
    await expect(page.getByText("Curriculum mapping saved.")).toBeVisible();
    await expect(curriculumPage.formDialog).toBeHidden();
    await expect(
      curriculumPage.row("Mathematics").getByRole("cell", { name: "6", exact: true }),
    ).toBeVisible();
  });

  test("removes a subject through the confirm dialog", async ({ page, curriculumPage }) => {
    await curriculumPage.rowAction("English", "Grade 1", "Remove").click();
    await expect(curriculumPage.removeDialog).toHaveAccessibleName("Remove this subject");
    await expect(curriculumPage.removeDialog).toContainText("English will no longer be part of");

    const request = page.waitForRequest((r) => isCurriculumCall(r, "DELETE", ROW_PATH));
    await curriculumPage.confirmRemove.click();
    await request;

    await expect(page.getByText("Subject removed from the curriculum.")).toBeVisible();
    await expect(curriculumPage.removeDialog).toBeHidden();
    await expect(curriculumPage.row("English")).toHaveCount(0);
    await expect(curriculumPage.row("Mathematics")).toBeVisible();
  });

  test("clones into the next session and moves the screen there", async ({
    page,
    curriculumPage,
  }) => {
    await curriculumPage.cloneButton.click();
    // Target first: picking the source's own session as the target would clear the source.
    await curriculumPage.chooseOption(curriculumPage.cloneSelect("Copy into"), "2027-28");
    await curriculumPage.chooseOption(curriculumPage.cloneSelect("Copy from"), "2026-27");

    const request = page.waitForRequest((r) => isCurriculumCall(r, "POST", CLONE_PATH));
    await curriculumPage.cloneSubmit.click();

    expect((await request).postDataJSON()).toEqual({
      source_academic_session_id: currentSession.id,
      target_academic_session_id: nextSession.id,
    });
    // English came across; the target's own Mathematics was already there, so it was skipped.
    await expect(page.getByText("1 mappings created, 1 already present.")).toBeVisible();
    await expect(curriculumPage.cloneDialog).toBeHidden();

    await expect(page).toHaveURL(new RegExp(`[?&]session=${nextSession.id}`));
    await expect(curriculumPage.sessionPicker).toContainText("2027-28");
    // The target's own 3-period Mathematics row, not the source's 5: the screen is on 2027-28.
    await expect(
      curriculumPage.row("Mathematics").getByRole("cell", { name: "3", exact: true }),
    ).toBeVisible();
    await expect(curriculumPage.row("English")).toBeVisible();
  });
});

test.describe("curriculum screen, closed session", () => {
  test.use({ authUser: schoolAdmin });

  test("shows the read-only notice, with no Add button and no row actions", async ({
    signedIn: _signedIn,
    mockApi,
    curriculumPage,
  }) => {
    const rows = [
      buildCurriculum({
        academic_session_id: closedSession.id,
        academic_session_name: "2025-26",
        subject_id: mathematics.id,
        subject_name: "Mathematics",
      }),
    ];
    stubCurriculumApi(mockApi, rows);
    await curriculumPage.gotoSession(closedSession.id);

    await expect(curriculumPage.lockedNotice("2025-26")).toBeVisible();
    await expect(curriculumPage.row("Mathematics")).toBeVisible();
    // The same admin sees all of these on the current session (the tests above).
    await expect(curriculumPage.addSubjectButton).toHaveCount(0);
    await expect(curriculumPage.cloneButton).toHaveCount(0);
    await expect(curriculumPage.rowAction("Mathematics", "Grade 1", "Edit")).toHaveCount(0);
    await expect(curriculumPage.rowAction("Mathematics", "Grade 1", "Remove")).toHaveCount(0);
  });
});
