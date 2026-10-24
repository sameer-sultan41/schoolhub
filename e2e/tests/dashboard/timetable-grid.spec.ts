import { expect, test } from "@/fixtures";
import {
  buildUser,
  ORG_IDS,
  SCHOOL_ADMIN_PERMISSIONS,
  TIMETABLE_GRID_PERMISSIONS,
  uuid,
} from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  academicsAllocationsModule,
  academicsCurriculumModule,
  buildAcademicSession,
  buildAllocation,
  buildCampus,
  buildCurriculum,
  buildPeriod,
  buildSchoolClass,
  buildSection,
  buildSlot,
  buildStaff,
  buildSubject,
  type MockApi,
  schoolOrganizationModule,
  staffModule,
  timetableGridModule,
  timetableSetupModule,
} from "@/mocks";

/**
 * `/timetable/grid` against a stubbed API: the cell editor's requests, the conflict panel, the
 * publish confirm, and drag-and-drop by pointer and by keyboard. The stub mirrors only what
 * the screen surfaces (`timetableGridModule`'s header); whether the server agrees is the API
 * suite's and the nightly build-and-publish journey's job.
 */

const session = buildAcademicSession({ id: ORG_IDS.currentSession, name: "2026-27" });
const campus = buildCampus({ id: ORG_IDS.mainCampus, name: "Main Campus" });
const grade1 = buildSchoolClass({ id: ORG_IDS.grade1, name: "Grade 1" });
const sectionA = buildSection({
  id: ORG_IDS.sectionA,
  name: "A",
  class_id: grade1.id,
  campus_id: campus.id,
});
const maths = buildSubject({ name: "Mathematics" });
const science = buildSubject({ name: "Science" });
const amna = buildStaff({ id: uuid(), first_name: "Amna", last_name: "Raza" });
const period1 = buildPeriod({ id: uuid(), name: "Period 1", sequence: 1 });
const recess = buildPeriod({
  id: uuid(),
  name: "Recess",
  sequence: 2,
  start_time: "10:00:00",
  end_time: "10:20:00",
  is_break: true,
});

const builder = buildUser({
  permissions: [...SCHOOL_ADMIN_PERMISSIONS, ...TIMETABLE_GRID_PERMISSIONS],
});

const GRID_URL = `/timetable/grid?class=${grade1.id}&section=${sectionA.id}`;
const SLOTS_PATH = /\/timetable-slots$/;
const SLOT_PATH = /\/timetable-slots\/[^/]+$/;

/** Amna is allocated Mathematics only; Science with her is the hard conflict. */
function stubGrid(
  mockApi: MockApi,
  slots = [
    buildSlot({
      period_id: period1.id,
      subject_id: maths.id,
      subject_name: "Mathematics",
      staff_id: amna.id,
      staff_name: "Amna Raza",
    }),
  ],
) {
  mockApi.use(
    schoolOrganizationModule({
      campuses: [campus],
      classes: [grade1],
      sections: [sectionA],
      subjects: [maths, science],
      academicSessions: [session],
    }),
    timetableSetupModule({ campuses: [campus], periods: [period1, recess] }),
    staffModule({ staff: [amna] }),
    academicsCurriculumModule({
      rows: [maths, science].map((subject) =>
        buildCurriculum({ subject_id: subject.id, subject_name: subject.name }),
      ),
    }),
    academicsAllocationsModule({
      rows: [buildAllocation({ subject_id: maths.id, staff_id: amna.id })],
    }),
    timetableGridModule({
      slots,
      allocations: [{ section_id: sectionA.id, subject_id: maths.id, staff_id: amna.id }],
      periods: [period1, recess],
      subjects: [maths, science],
      staff: [{ id: amna.id, name: "Amna Raza" }],
    }),
  );
}

test.describe("week grid", () => {
  test.use({ authUser: builder });

  test("is the Timetable group's first section", async ({
    page,
    mockApi,
    dashboardPage,
    signedIn: _signedIn,
  }) => {
    stubGrid(mockApi);
    await dashboardPage.goto();

    await dashboardPage.navGroup("Timetable").click();
    await dashboardPage.navLink("Week grid").click();

    await expect(page).toHaveURL(/\/timetable\/grid$/);
    await expect(dashboardPage.sectionTab("Week grid", "Timetable")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test.describe("on a section", () => {
    test.beforeEach(async ({ signedIn: _signedIn, mockApi, weekGridPage }) => {
      stubGrid(mockApi);
      await weekGridPage.goto({ path: GRID_URL });
      await expect(weekGridPage.filledCell("Monday", "Period 1")).toBeVisible();
    });

    test("reports a clash on save, blocks publish, and publishes once fixed", async ({
      page,
      weekGridPage,
    }) => {
      const request = page.waitForRequest((r) => isApiCall(r, "POST", SLOTS_PATH));
      await weekGridPage.fillCellWith({
        weekday: "Tuesday",
        periodName: "Period 1",
        subjectName: "Science",
        teacherName: "Amna Raza",
      });
      expect((await request).postDataJSON()).toMatchObject({
        day_of_week: 1,
        period_id: period1.id,
      });
      await expect(
        weekGridPage.conflictPanel.getByText(/no allocation for this section and subject/),
      ).toBeVisible();

      await weekGridPage.publish.click();
      await weekGridPage.publishDialog
        .getByRole("button", { name: "Publish", exact: true })
        .click();
      await expect(weekGridPage.publishDialog).toContainText("unresolved hard conflicts");
      await weekGridPage.publishDialog.getByRole("button", { name: "Cancel" }).click();

      await weekGridPage.changeCellSubject({
        weekday: "Tuesday",
        periodName: "Period 1",
        subjectName: "Mathematics",
      });
      await weekGridPage.validate.click();
      await expect(weekGridPage.noConflicts).toBeVisible();
      await expect(weekGridPage.conflictPanel).toHaveCount(0);

      await weekGridPage.publishAndConfirm();
      await expect(weekGridPage.publishedSummary(2)).toBeVisible();
      await expect(weekGridPage.filledCell("Tuesday", "Period 1")).toContainText("Published");
    });

    test("keeps a break inert", async ({ weekGridPage }) => {
      await expect(weekGridPage.emptyCell("Monday", "Recess")).toHaveCount(0);
    });

    test("opens the editor, not a drag, on Space over a cell", async ({ page, weekGridPage }) => {
      await weekGridPage.filledCell("Monday", "Period 1").focus();
      await page.keyboard.press("Space");

      await expect(weekGridPage.dialog).toBeVisible();
    });

    test("moves a draft by pointer, stepping past the activation distance", async ({
      page,
      weekGridPage,
    }) => {
      const handle = weekGridPage.moveHandle("Monday", "Period 1");
      const target = weekGridPage.emptyCell("Wednesday", "Period 1");
      const from = await handle.boundingBox();
      const to = await target.boundingBox();
      if (!from || !to) throw new Error("expected the handle and the target on screen");

      const request = page.waitForRequest((r) => isApiCall(r, "PATCH", SLOT_PATH));
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 5 });
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
      await page.mouse.up();

      expect((await request).postDataJSON()).toEqual({ day_of_week: 2, period_id: period1.id });
      await expect(weekGridPage.filledCell("Wednesday", "Period 1")).toBeVisible();
    });

    test("moves a draft by keyboard, one cell per arrow key", async ({ page, weekGridPage }) => {
      const request = page.waitForRequest((r) => isApiCall(r, "PATCH", SLOT_PATH));
      await weekGridPage.keyboardMove("Monday", "Period 1", [
        { key: "ArrowRight", over: "Tuesday · Period 1" },
        { key: "ArrowRight", over: "Wednesday · Period 1" },
      ]);

      expect((await request).postDataJSON()).toEqual({ day_of_week: 2, period_id: period1.id });
    });
  });

  test("refuses a pointer drop on a break, without a request", async ({
    page,
    mockApi,
    weekGridPage,
    signedIn: _signedIn,
  }) => {
    stubGrid(mockApi);
    await weekGridPage.goto({ path: GRID_URL });
    const patches: string[] = [];
    page.on("request", (r) => {
      if (isApiCall(r, "PATCH", SLOT_PATH)) patches.push(r.url());
    });

    const from = await weekGridPage.moveHandle("Monday", "Period 1").boundingBox();
    const to = await page.getByRole("cell", { name: "Break" }).first().boundingBox();
    if (!from || !to) throw new Error("expected the handle and the break on screen");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 20, { steps: 5 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
    await page.mouse.up();

    await expect(weekGridPage.refusedToast("Not moved: that period is a break.")).toBeVisible();
    expect(patches).toEqual([]);
  });

  test("moves a draft left by keyboard, measured from its cell", async ({
    page,
    mockApi,
    weekGridPage,
    signedIn: _signedIn,
  }) => {
    stubGrid(mockApi, [
      buildSlot({
        day_of_week: 1,
        period_id: period1.id,
        subject_id: maths.id,
        subject_name: "Mathematics",
      }),
    ]);
    await weekGridPage.goto({ path: GRID_URL });

    const request = page.waitForRequest((r) => isApiCall(r, "PATCH", SLOT_PATH));
    await weekGridPage.keyboardMove("Tuesday", "Period 1", [
      { key: "ArrowLeft", over: "Monday · Period 1" },
    ]);

    expect((await request).postDataJSON()).toEqual({ day_of_week: 0, period_id: period1.id });
  });

  test("gives a published cell no move handle", async ({
    mockApi,
    weekGridPage,
    signedIn: _signedIn,
  }) => {
    stubGrid(mockApi, [
      buildSlot({
        period_id: period1.id,
        subject_id: maths.id,
        subject_name: "Mathematics",
        status: "published",
      }),
    ]);
    await weekGridPage.goto({ path: GRID_URL });

    await expect(weekGridPage.filledCell("Monday", "Period 1")).toContainText("Published");
    await expect(weekGridPage.moveHandle("Monday", "Period 1")).toHaveCount(0);
  });
});
