import { expect, test } from "@/fixtures";
import {
  ACADEMICS_ALLOCATION_PERMISSIONS,
  buildUser,
  ORG_IDS,
  SCHOOL_ADMIN_PERMISSIONS,
  uuid,
} from "@/data/factories";
import {
  academicsAllocationsModule,
  academicsCurriculumModule,
  type Allocation,
  buildAcademicSession,
  buildAllocation,
  buildCurriculum,
  buildSchoolClass,
  buildSection,
  buildStaff,
  buildSubject,
  type MockApi,
  schoolOrganizationModule,
  type Section,
  type Staff,
  staffModule,
  type Subject,
} from "@/mocks";

/**
 * The `/academics/allocations` screen and its place in the Academics sidebar group: allocate,
 * edit, end, reinstate and remove, the Current/Ended filter and its URL state, the teacher-load
 * panel, and the closed-session read-only state, against a stubbed API.
 *
 * What this proves is the dashboard's half: the dialogs send the right request, the table, the
 * load panel and the URL reflect the response, and the sidebar and toolbar gate on the viewer's
 * keys. Whether the server accepts a write (the session lock, §11's teacher and curriculum
 * rules, the `effective_to` rules, tenant scoping) is the API's own test suite and the `live`
 * lane's job; the stub returns whatever it was told to.
 */

const currentSession = buildAcademicSession({ id: ORG_IDS.currentSession, name: "2026-27" });
const closedSession = buildAcademicSession({
  name: "2025-26",
  status: "closed",
  is_current: false,
});
const sessions = [closedSession, currentSession];

const grade1 = buildSchoolClass({ id: ORG_IDS.grade1, name: "Grade 1" });
const classes = [grade1];
const sectionA = buildSection({
  id: ORG_IDS.sectionA,
  name: "A",
  class_id: ORG_IDS.grade1,
  campus_id: ORG_IDS.mainCampus,
});
const sectionB = buildSection({
  id: ORG_IDS.sectionB,
  name: "B",
  class_id: ORG_IDS.grade1,
  campus_id: ORG_IDS.mainCampus,
});
const sections = [sectionA, sectionB];
const mathematics = buildSubject({ name: "Mathematics" });
const english = buildSubject({ name: "English" });
const science = buildSubject({ name: "Science" });
const subjects = [mathematics, english, science];

// UUID ids: the allocate form and the teacher filter both take only a UUID.
const ayesha = buildStaff({
  id: uuid(),
  first_name: "Ayesha",
  last_name: "Khan",
  employee_number: "EMP-0002",
});
const bilal = buildStaff({ id: uuid(), first_name: "Bilal", last_name: "Ahmed" });
const staff = [ayesha, bilal];

// What Grade 1 studies in 2026-27: the only subjects the allocate dialog offers for it, and
// the periods an allocation with no override counts for.
const curriculum = [
  buildCurriculum({ subject_id: mathematics.id, subject_name: "Mathematics", weekly_periods: 5 }),
  buildCurriculum({ subject_id: english.id, subject_name: "English", weekly_periods: 4 }),
  buildCurriculum({ subject_id: science.id, subject_name: "Science", weekly_periods: 3 }),
];

const allocationAdmin = buildUser({
  permissions: [...SCHOOL_ADMIN_PERMISSIONS, ...ACADEMICS_ALLOCATION_PERMISSIONS],
});
const viewOnlyUser = buildUser({
  permissions: [...SCHOOL_ADMIN_PERMISSIONS, "academics.teacher-allocation.view"],
});

const COLLECTION_PATH = /\/teacher-subject-allocations$/;
const ROW_PATH = /\/teacher-subject-allocations\/[^/]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What the helpers below read off a Playwright `Request`, which a spec may not import. */
interface RequestLike {
  method(): string;
  url(): string;
}

/** Whether `request` is a `method` call to an allocations path matching `path`. */
function isAllocationCall(request: RequestLike, method: string, path: RegExp): boolean {
  return request.method() === method && path.test(new URL(request.url()).pathname);
}

/** The allocations list read, with the `current` flag it was asked for (`null`: not asked). */
function isListCall(request: RequestLike, current: string | null): boolean {
  return (
    isAllocationCall(request, "GET", COLLECTION_PATH) &&
    new URL(request.url()).searchParams.get("current") === current
  );
}

function allocationOf(
  teacher: Staff,
  subject: Subject,
  section: Section,
  overrides: Partial<Allocation> = {},
): Allocation {
  return buildAllocation({
    staff_id: teacher.id,
    staff_name: `${teacher.first_name} ${teacher.last_name}`,
    subject_id: subject.id,
    subject_name: subject.name,
    section_id: section.id,
    section_name: section.name,
    ...overrides,
  });
}

/** Fresh rows per test: a PATCH mutates the row objects the stub holds. */
function buildRows() {
  return [
    // Bilal teaches 20 + 12 = 32 periods, over the norm of 30.
    allocationOf(bilal, mathematics, sectionA, { weekly_periods: 20 }),
    allocationOf(bilal, english, sectionB, { weekly_periods: 12 }),
    // Ayesha teaches 18, within it, and has one ended allocation left in the history.
    allocationOf(ayesha, english, sectionA, { weekly_periods: 18 }),
    allocationOf(ayesha, science, sectionB, {
      is_primary: false,
      weekly_periods: 6,
      effective_to: "2026-06-30",
    }),
  ];
}

/** How each row's action buttons name it (see `AllocationsPage.rowAction`). */
const BILAL_MATHEMATICS_A = {
  teacher: "Bilal Ahmed",
  subject: "Mathematics",
  className: "Grade 1",
  sectionName: "A",
};
const BILAL_ENGLISH_B = {
  teacher: "Bilal Ahmed",
  subject: "English",
  className: "Grade 1",
  sectionName: "B",
};
const AYESHA_ENGLISH_A = {
  teacher: "Ayesha Khan",
  subject: "English",
  className: "Grade 1",
  sectionName: "A",
};
const AYESHA_SCIENCE_B = {
  teacher: "Ayesha Khan",
  subject: "Science",
  className: "Grade 1",
  sectionName: "B",
};

/** Stubs what the screen reads: the reference lists, the curriculum and the allocations. */
function stubAllocationsApi(mockApi: MockApi, rows = buildRows()) {
  mockApi.use(
    schoolOrganizationModule({ classes, sections, subjects, academicSessions: sessions }),
    staffModule({ staff }),
    academicsCurriculumModule({ rows: curriculum, sessions, classes, subjects }),
    academicsAllocationsModule({ rows, sessions, sections, classes, subjects, staff, curriculum }),
  );
}

test.describe("academics sidebar group, teacher allocation", () => {
  test.describe("with the teacher-allocation keys", () => {
    test.use({ authUser: allocationAdmin });

    test("lists Teacher allocation without Curriculum and opens the screen", async ({
      page,
      mockApi,
      dashboardPage,
      allocationsPage,
      signedIn: _signedIn,
    }) => {
      stubAllocationsApi(mockApi);
      await dashboardPage.goto();

      // Closed until clicked: a child is out of the DOM until its group opens.
      await dashboardPage.navGroup("Academics").click();
      await expect(dashboardPage.navLink("Teacher allocation")).toBeVisible();
      // Each child is gated on its own `.view` key, and this user holds none for Curriculum.
      await expect(dashboardPage.navLink("Curriculum")).toHaveCount(0);
      await dashboardPage.navLink("Teacher allocation").click();

      await expect(page).toHaveURL(/\/academics\/allocations$/);
      await expect(allocationsPage.heading).toHaveText("Teacher allocation");
    });
  });

  test.describe("with only the teacher-allocation view key", () => {
    test.use({ authUser: viewOnlyUser });

    test("sends /academics to the allocations screen", async ({
      page,
      mockApi,
      dashboardPage,
      allocationsPage,
      signedIn: _signedIn,
    }) => {
      stubAllocationsApi(mockApi);

      // `/academics` has no page of its own: it sends the viewer to their first section.
      await dashboardPage.goto({ path: "/academics" });

      await expect(page).toHaveURL(/\/academics\/allocations$/);
      await expect(allocationsPage.heading).toHaveText("Teacher allocation");
    });

    test("shows the rows with no Allocate button and no row actions", async ({
      mockApi,
      allocationsPage,
      signedIn: _signedIn,
    }) => {
      stubAllocationsApi(mockApi);
      await allocationsPage.goto();

      await expect(allocationsPage.row("Bilal Ahmed", "Mathematics")).toBeVisible();
      // The same stubs give an admin all of these (the tests below).
      await expect(allocationsPage.allocateButton).toHaveCount(0);
      await expect(allocationsPage.rowActions).toHaveCount(0);
    });
  });

  test.describe("with only the promotion view key", () => {
    // The module key is held, but neither section's `.view` is; with no child left, the group
    // goes. (PR C adds the Promotions landing assertion.)
    test.use({
      authUser: buildUser({
        permissions: [...SCHOOL_ADMIN_PERMISSIONS, "academics.promotion.view"],
      }),
    });

    test("shows no Academics group, Curriculum or Teacher allocation link", async ({
      dashboardPage,
      signedIn: _signedIn,
    }) => {
      await dashboardPage.goto();

      // A link the user does hold, so the menu is known to be filtered for the loaded user
      // before the group's absence is asserted.
      await expect(dashboardPage.navLink("Students")).toBeVisible();
      await expect(dashboardPage.navGroup("Academics")).toHaveCount(0);
      await expect(dashboardPage.navLink("Curriculum")).toHaveCount(0);
      await expect(dashboardPage.navLink("Teacher allocation")).toHaveCount(0);
    });
  });
});

test.describe("teacher allocation screen", () => {
  test.use({ authUser: allocationAdmin });

  test.beforeEach(async ({ signedIn: _signedIn, mockApi, allocationsPage }) => {
    stubAllocationsApi(mockApi);
    // No `session` in the URL, so this is the current session, and the default filter is the
    // current allocations: Ayesha's ended Science is not listed.
    await allocationsPage.goto();
    await expect(allocationsPage.row("Bilal Ahmed", "Mathematics")).toBeVisible();
  });

  test("shows each teacher's weekly load, over-norm teachers first", async ({
    allocationsPage,
  }) => {
    // The server lists teachers by name, so Ayesha would come first: Bilal leads because he
    // is over the norm.
    await expect(allocationsPage.loadTable.getByRole("row").nth(1)).toContainText("Bilal Ahmed");
    const bilalLoad = allocationsPage.loadRow("Bilal Ahmed");
    await expect(bilalLoad).toContainText("Over norm");
    await expect(bilalLoad.getByRole("cell", { name: "32", exact: true })).toBeVisible();
    const ayeshaLoad = allocationsPage.loadRow("Ayesha Khan");
    await expect(ayeshaLoad).toContainText("Within norm");
    await expect(ayeshaLoad.getByRole("cell", { name: "18", exact: true })).toBeVisible();
  });

  test("allocates a teacher and warns when the load goes over the norm", async ({
    page,
    allocationsPage,
  }) => {
    await allocationsPage.allocateButton.click();
    await allocationsPage.chooseOption(allocationsPage.formSelect("Class"), "Grade 1");
    await allocationsPage.chooseOption(allocationsPage.formSelect("Section"), "A");
    await allocationsPage.chooseOption(allocationsPage.formSelect("Subject"), "Science");
    await allocationsPage.chooseOption(allocationsPage.formSelect("Teacher"), "Ayesha Khan");
    await allocationsPage.weeklyPeriodsInput.fill("14");

    const request = page.waitForRequest((r) => isAllocationCall(r, "POST", COLLECTION_PATH));
    await allocationsPage.saveButton.click();

    // The session is the screen's, the class only drove the pickers, and there is no
    // `effective_to`: an allocation is never created already ended.
    expect((await request).postDataJSON()).toEqual({
      academic_session_id: currentSession.id,
      section_id: sectionA.id,
      subject_id: science.id,
      staff_id: ayesha.id,
      is_primary: true,
      weekly_periods: 14,
      effective_from: null,
    });
    await expect(page.getByText("Allocation saved.", { exact: true })).toBeVisible();
    // 18 + 14 periods is above the norm of 30: the stub's warning shows, and the save stands.
    const warning = page.getByText(/now allocated 32 periods a week, above the norm of 30/);
    await expect(warning).toBeVisible();
    await expect(allocationsPage.formDialog).toBeHidden();
    await expect(allocationsPage.row("Ayesha Khan", "Science")).toBeVisible();
    // The write refreshed the load panel too.
    await expect(allocationsPage.loadRow("Ayesha Khan")).toContainText("Over norm");
  });

  test("edits the weekly periods and sends only what changed", async ({
    page,
    allocationsPage,
  }) => {
    await allocationsPage.rowAction("Edit", BILAL_MATHEMATICS_A).click();
    await expect(allocationsPage.formDialog).toHaveAccessibleName("Edit allocation");
    // The section, subject and teacher identify an allocation, so the dialog shows them
    // read-only.
    await expect(allocationsPage.formDialog).toContainText("Bilal Ahmed");
    await expect(allocationsPage.formSelect("Teacher")).toHaveCount(0);
    await expect(allocationsPage.weeklyPeriodsInput).toHaveValue("20");
    await allocationsPage.weeklyPeriodsInput.fill("16");

    const request = page.waitForRequest((r) => isAllocationCall(r, "PATCH", ROW_PATH));
    await allocationsPage.saveButton.click();

    // Neither the unchanged role and start date nor `effective_to` (End and Reinstate own it).
    expect((await request).postDataJSON()).toEqual({ weekly_periods: 16 });
    await expect(page.getByText("Allocation saved.", { exact: true })).toBeVisible();
    await expect(allocationsPage.formDialog).toBeHidden();
    const mathematicsRow = allocationsPage.row("Bilal Ahmed", "Mathematics");
    await expect(mathematicsRow.getByRole("cell", { name: "16", exact: true })).toBeVisible();
    // 16 + 12 periods is within the norm now.
    await expect(allocationsPage.loadRow("Bilal Ahmed")).toContainText("Within norm");
  });

  test("ends an allocation today, then reinstates it", async ({ page, allocationsPage }) => {
    await allocationsPage.rowAction("End", AYESHA_ENGLISH_A).click();
    await expect(allocationsPage.confirmDialog).toHaveAccessibleName("End this allocation");

    const ended = page.waitForRequest((r) => isAllocationCall(r, "PATCH", ROW_PATH));
    await allocationsPage.confirm("End").click();

    // Only the date, and the UTC one (the server counts "today" in UTC).
    const endBody = (await ended).postDataJSON() as Record<string, unknown>;
    expect(Object.keys(endBody)).toEqual(["effective_to"]);
    expect(endBody["effective_to"]).toMatch(ISO_DATE);
    await expect(page.getByText("Allocation ended.", { exact: true })).toBeVisible();
    await expect(allocationsPage.confirmDialog).toBeHidden();
    // It left the current list, and her load with it: English was her only current allocation.
    await expect(allocationsPage.row("Ayesha Khan", "English")).toHaveCount(0);
    await expect(allocationsPage.loadRow("Ayesha Khan")).toHaveCount(0);

    await allocationsPage.chooseOption(allocationsPage.filter("Status"), "Ended");
    await expect(allocationsPage.row("Ayesha Khan", "English")).toContainText(/Ended/);

    const reinstated = page.waitForRequest((r) => isAllocationCall(r, "PATCH", ROW_PATH));
    await allocationsPage.rowAction("Reinstate", AYESHA_ENGLISH_A).click();
    await expect(allocationsPage.confirmDialog).toHaveAccessibleName("Reinstate this allocation");
    await allocationsPage.confirm("Reinstate").click();

    expect((await reinstated).postDataJSON()).toEqual({ effective_to: null });
    await expect(page.getByText("Allocation reinstated.", { exact: true })).toBeVisible();
    await expect(allocationsPage.row("Ayesha Khan", "English")).toHaveCount(0);

    await allocationsPage.chooseOption(allocationsPage.filter("Status"), "Current");
    await expect(allocationsPage.row("Ayesha Khan", "English")).toContainText("Current");
    await expect(allocationsPage.loadRow("Ayesha Khan")).toBeVisible();
  });

  test("removes an allocation through the confirm dialog", async ({ page, allocationsPage }) => {
    await allocationsPage.rowAction("Remove", BILAL_ENGLISH_B).click();
    await expect(allocationsPage.confirmDialog).toHaveAccessibleName("Remove this allocation");

    const request = page.waitForRequest((r) => isAllocationCall(r, "DELETE", ROW_PATH));
    await allocationsPage.confirm("Remove").click();
    await request;

    await expect(page.getByText("Allocation removed.", { exact: true })).toBeVisible();
    await expect(allocationsPage.confirmDialog).toBeHidden();
    await expect(allocationsPage.row("Bilal Ahmed", "English")).toHaveCount(0);
    await expect(allocationsPage.row("Bilal Ahmed", "Mathematics")).toBeVisible();
  });

  test("filters by ended, and back to all", async ({ page, allocationsPage }) => {
    const endedRequest = page.waitForRequest((r) => isListCall(r, "false"));
    await allocationsPage.chooseOption(allocationsPage.filter("Status"), "Ended");
    await endedRequest;

    await expect(page).toHaveURL(/[?&]state=ended(&|$)/);
    await expect(allocationsPage.row("Ayesha Khan", "Science")).toContainText(/Ended/);
    await expect(allocationsPage.row("Bilal Ahmed")).toHaveCount(0);
    await expect(allocationsPage.row("English")).toHaveCount(0);
    // An ended allocation can be reinstated, not ended again.
    await expect(allocationsPage.rowAction("Reinstate", AYESHA_SCIENCE_B)).toBeVisible();
    await expect(allocationsPage.rowAction("End", AYESHA_SCIENCE_B)).toHaveCount(0);

    // "All" asks with no `current` flag at all, and lists both.
    const allRequest = page.waitForRequest((r) => isListCall(r, null));
    await allocationsPage.chooseOption(allocationsPage.filter("Status"), "All");
    await allRequest;

    await expect(allocationsPage.row("Ayesha Khan", "Science")).toBeVisible();
    await expect(allocationsPage.row("Bilal Ahmed", "Mathematics")).toBeVisible();
  });

  test("a reload keeps the status, class and search filters and the request", async ({
    page,
    allocationsPage,
  }) => {
    await allocationsPage.chooseOption(allocationsPage.filter("Status"), "Ended");
    await allocationsPage.chooseOption(allocationsPage.filter("Class"), "Grade 1");
    await allocationsPage.searchInput.fill("Science");
    // The search is debounced into the address: reload only once all three have landed.
    await expect(page).toHaveURL(/[?&]search=Science(&|$)/);
    await expect(page).toHaveURL(/[?&]state=ended(&|$)/);
    await expect(page).toHaveURL(new RegExp(`[?&]class=${grade1.id}(&|$)`));
    await expect(allocationsPage.row("Ayesha Khan", "Science")).toBeVisible();

    const afterReload = page.waitForRequest((r) => isListCall(r, "false"));
    await page.reload();

    await expect(allocationsPage.filter("Status")).toContainText("Ended");
    await expect(allocationsPage.filter("Class")).toContainText("Grade 1");
    await expect(allocationsPage.searchInput).toHaveValue("Science");
    await expect(allocationsPage.row("Ayesha Khan", "Science")).toBeVisible();
    await expect(allocationsPage.row("Bilal Ahmed")).toHaveCount(0);
    // The same address asks the API for the same list.
    const query = new URL((await afterReload).url()).searchParams;
    expect(query.get("search")).toBe("Science");
    expect(query.get("class_id")).toBe(grade1.id);
  });
});

test.describe("teacher allocation screen, closed session", () => {
  test.use({ authUser: allocationAdmin });

  test("shows the read-only notice, with no Allocate button and no row actions", async ({
    signedIn: _signedIn,
    mockApi,
    allocationsPage,
  }) => {
    const rows = [
      allocationOf(ayesha, english, sectionA, {
        academic_session_id: closedSession.id,
        weekly_periods: 18,
      }),
    ];
    stubAllocationsApi(mockApi, rows);
    await allocationsPage.gotoSession(closedSession.id);

    await expect(allocationsPage.lockedNotice("2025-26")).toBeVisible();
    await expect(allocationsPage.row("Ayesha Khan", "English")).toBeVisible();
    // The same admin sees all of these on the current session (the tests above).
    await expect(allocationsPage.allocateButton).toHaveCount(0);
    await expect(allocationsPage.rowActions).toHaveCount(0);
  });
});
