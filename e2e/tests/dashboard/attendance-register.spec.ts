import { expect, test } from "@/fixtures";
import {
  ATTENDANCE_MARKER_PERMISSIONS,
  ATTENDANCE_SETTINGS_PERMISSIONS,
  ATTENDANCE_VIEWER_PERMISSIONS,
  buildUser,
  ORG_IDS,
  uuid,
} from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  ATTENDANCE_MESSAGES,
  type AttendanceRegisterOptions,
  AttendanceRegisterStore,
  attendanceRegisterModule,
  buildAcademicSession,
  buildSchoolClass,
  buildSection,
  type MockApi,
  type RosterStudent,
  schoolOrganizationModule,
  shiftIsoDate,
  todayUtc,
} from "@/mocks";

/**
 * `/attendance` against a stubbed API: a teacher marks a register from My registers, a refusal
 * lands on its row, a locked register is read-only with Request correction, a reader sees
 * Records and no Register, and the settings refuse period mode without the timetable. The stub
 * (`attendanceRegisterModule`) runs `:bulk-mark`'s checks in the service's order with the
 * service's sentences (L5); whether the server agrees is the Django suite's and the live
 * lane's job, and who may mark (assigned, campus and period markers) is proven only in Django.
 */

const USER_ID = uuid();
const session = buildAcademicSession({ id: ORG_IDS.currentSession, name: "2026-27" });
const grade5 = buildSchoolClass({ id: ORG_IDS.grade1, name: "Grade 5" });
const sectionA = buildSection({
  id: ORG_IDS.sectionA,
  name: "A",
  class_id: grade5.id,
  campus_id: ORG_IDS.mainCampus,
});
const REGISTER_NAME = "Grade 5 · A";

function student(name: string, roll: number): RosterStudent {
  return { id: uuid(), name, admissionNumber: `ADM-00${roll}`, rollNumber: String(roll) };
}
const amna = student("Amna Raza", 1);
const bilal = student("Bilal Khan", 2);
const sara = student("Sara Ali", 3);

const LOCKED_ROWS_NOTICE =
  "Rows past the lock window are read-only. Request a correction to change one.";

const BULK_MARK_PATH = /\/student-attendance:bulk-mark$/;
const CORRECTIONS_PATH = /\/attendance-corrections$/;
const SETTINGS_PATH = /\/attendance-settings$/;

const teacher = { ...buildUser({ permissions: ATTENDANCE_MARKER_PERMISSIONS }), id: USER_ID };

/** A fresh server per test: section A, the three students, and the rows a test seeds. */
function stubAttendance(
  mockApi: MockApi,
  options: Partial<AttendanceRegisterOptions> = {},
): AttendanceRegisterStore {
  const store = new AttendanceRegisterStore({
    session,
    userId: USER_ID,
    sections: [
      {
        id: sectionA.id,
        name: sectionA.name,
        classId: grade5.id,
        className: grade5.name,
        campusId: sectionA.campus_id,
        students: [amna, bilal, sara],
        classTeacher: true,
      },
    ],
    ...options,
  });
  mockApi.use(
    schoolOrganizationModule({
      classes: [grade5],
      sections: [sectionA],
      academicSessions: [session],
    }),
    attendanceRegisterModule(store),
  );
  return store;
}

test.describe("the register, as a class teacher", () => {
  test.use({ authUser: teacher });

  test("marks a register from My registers: all present, one absent, one late", async ({
    page,
    mockApi,
    attendanceRegisterPage,
    signedIn: _signedIn,
  }) => {
    stubAttendance(mockApi);
    await attendanceRegisterPage.goto();

    await attendanceRegisterPage.openRegister(REGISTER_NAME).click();
    await attendanceRegisterPage.markAllPresent.click();
    await attendanceRegisterPage.status(bilal.name, "Absent").click();
    await attendanceRegisterPage.status(sara.name, "Late").click();
    await attendanceRegisterPage.checkIn(sara.name).fill("08:20");

    const request = page.waitForRequest((r) => isApiCall(r, "POST", BULK_MARK_PATH));
    await attendanceRegisterPage.submit.click();

    expect((await request).postDataJSON()).toEqual({
      section_id: sectionA.id,
      attendance_date: todayUtc(),
      period_id: null,
      academic_session_id: session.id,
      entries: [
        { student_id: amna.id, status: "present" },
        { student_id: bilal.id, status: "absent" },
        { student_id: sara.id, status: "late", check_in_time: "08:20" },
      ],
    });
    await expect(
      page.getByText("Register saved: 3 marked, 0 updated, 2 guardian alerts queued."),
    ).toBeVisible();
    await expect(attendanceRegisterPage.status(bilal.name, "Absent")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("leave approved after the register opened refuses that row", async ({
    page,
    mockApi,
    attendanceRegisterPage,
    signedIn: _signedIn,
  }) => {
    const store = stubAttendance(mockApi);
    await attendanceRegisterPage.goto();
    await attendanceRegisterPage.openRegister(REGISTER_NAME).click();
    await attendanceRegisterPage.markAllPresent.click();

    // Leave is approved for Bilal while the register is open: the server, not the screen,
    // keeps him out of the register.
    store.approveLeave(bilal.id, todayUtc());
    await attendanceRegisterPage.submit.click();

    await expect(
      page.getByRole("alert").filter({ hasText: ATTENDANCE_MESSAGES.onLeaveRefused }),
    ).toBeVisible();
    await expect(attendanceRegisterPage.row(bilal.name)).toContainText(
      ATTENDANCE_MESSAGES.onApprovedLeave,
    );
    // The register reloaded: Bilal is on leave and read-only, and the others kept their marks.
    await expect(attendanceRegisterPage.row(bilal.name)).toContainText("On leave");
    await expect(attendanceRegisterPage.statusGroup(bilal.name)).toHaveCount(0);
    await expect(attendanceRegisterPage.status(amna.name, "Present")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    const resubmit = page.waitForRequest((r) => isApiCall(r, "POST", BULK_MARK_PATH));
    await attendanceRegisterPage.submit.click();

    const entries = ((await resubmit).postDataJSON() as { entries: { student_id: string }[] })
      .entries;
    expect(entries.map((entry) => entry.student_id)).toEqual([amna.id, sara.id]);
    await expect(
      page.getByText("Register saved: 2 marked, 0 updated, no guardian alerts queued."),
    ).toBeVisible();
  });

  test("a register past the lock window is read-only, and a row can be corrected", async ({
    page,
    mockApi,
    attendanceRegisterPage,
    signedIn: _signedIn,
  }) => {
    const pastDate = shiftIsoDate(todayUtc(), -3);
    const store = stubAttendance(mockApi);
    const section = store.sections[0];
    if (!section) throw new Error("expected section A");
    for (const student of section.students) {
      store.records.push(store.recordFor(section, student, pastDate, { status: "present" }));
    }
    const amnaRow = store.find(amna.id, pastDate, null);
    if (!amnaRow) throw new Error("expected Amna's row");

    await attendanceRegisterPage.goto({
      path: `/attendance/register?date=${pastDate}&section=${sectionA.id}`,
    });

    await expect(attendanceRegisterPage.row(amna.name)).toContainText("Locked");
    await expect(attendanceRegisterPage.statusGroup(amna.name)).toHaveCount(0);
    await expect(page.getByText(LOCKED_ROWS_NOTICE)).toBeVisible();
    await expect(attendanceRegisterPage.submit).toHaveCount(0);

    await attendanceRegisterPage.requestCorrection(amna.name).click();
    await attendanceRegisterPage.correctionStatus.click();
    await attendanceRegisterPage.option("Absent").click();
    await attendanceRegisterPage.correctionReason.fill("She was marked present by mistake.");

    const request = page.waitForRequest((r) => isApiCall(r, "POST", CORRECTIONS_PATH));
    await attendanceRegisterPage.correctionSubmit.click();

    expect((await request).postDataJSON()).toEqual({
      student_attendance_id: amnaRow.id,
      new_values: { status: "absent" },
      reason: "She was marked present by mistake.",
    });
    await expect(attendanceRegisterPage.correctionDialog).toBeHidden();
    // A correction changes nothing until it is approved.
    await expect(attendanceRegisterPage.row(amna.name)).toContainText("Present");
  });
});

test.describe("attendance, as a reader who may not mark", () => {
  test.use({ authUser: buildUser({ permissions: ATTENDANCE_VIEWER_PERMISSIONS }) });

  test("lands on Records, with no Register tab", async ({
    page,
    mockApi,
    dashboardPage,
    attendanceRecordsPage,
    signedIn: _signedIn,
  }) => {
    const store = stubAttendance(mockApi);
    const section = store.sections[0];
    if (!section) throw new Error("expected section A");
    store.records.push(store.recordFor(section, amna, todayUtc(), { status: "present" }));

    await page.goto("/attendance");

    await expect(page).toHaveURL(/\/attendance\/records/);
    await expect(dashboardPage.sectionTab("Records", "Attendance")).toBeVisible();
    await expect(dashboardPage.sectionTab("Register", "Attendance")).toHaveCount(0);
    await expect(dashboardPage.sectionTab("Settings", "Attendance")).toHaveCount(0);
    await expect(attendanceRecordsPage.row(amna.name)).toContainText("Present");
  });
});

test.describe("attendance settings", () => {
  test.use({ authUser: buildUser({ permissions: ATTENDANCE_SETTINGS_PERMISSIONS }) });

  test("refuses period mode without the timetable; a lock window saves alone", async ({
    page,
    mockApi,
    attendanceSettingsPage,
    signedIn: _signedIn,
  }) => {
    const store = stubAttendance(mockApi, { timetableEnabled: false });
    await attendanceSettingsPage.goto();

    await attendanceSettingsPage.mode("Period").click();
    await attendanceSettingsPage.save.click();

    await expect(page.getByText(ATTENDANCE_MESSAGES.timetableRequired)).toBeVisible();
    expect(store.mode).toBe("daily");

    await attendanceSettingsPage.mode("Daily").click();
    await attendanceSettingsPage.lockWindow.fill("3");
    const request = page.waitForRequest((r) => isApiCall(r, "PATCH", SETTINGS_PATH));
    await attendanceSettingsPage.save.click();

    expect((await request).postDataJSON()).toEqual({ lock_window_days: 3 });
    await expect(page.getByText("Attendance settings saved.")).toBeVisible();
    expect(store.lockWindowDays).toBe(3);
  });
});
