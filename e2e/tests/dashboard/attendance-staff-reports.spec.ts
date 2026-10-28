import { expect, test } from "@/fixtures";
import {
  ATTENDANCE_HR_PERMISSIONS,
  ATTENDANCE_IMPORT_PERMISSIONS,
  ATTENDANCE_REPORT_PERMISSIONS,
  ATTENDANCE_STAFF_SELF_PERMISSIONS,
  buildRole,
  buildUser,
  ORG_IDS,
  uuid,
} from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  AttendanceRegisterStore,
  attendanceRegisterModule,
  type AttendanceStaffReportsOptions,
  AttendanceStaffReportsStore,
  attendanceStaffReportsModule,
  buildAcademicSession,
  buildSchoolClass,
  buildSection,
  buildStaffMember,
  jobsModule,
  type MockApi,
  REPORT_EXPORT_GLOB,
  type ReportSeed,
  schoolOrganizationModule,
  shiftIsoDate,
  staffName,
  todayUtc,
} from "@/mocks";

/**
 * `/attendance/staff`, `/attendance/reports` and the Records import against a stubbed API: HR
 * marks two staff members, checks one out and asks for a correction on a locked staff row; a
 * staff member without the mark key reads only their own history; a defaulters report runs at
 * 90% and exports to a file that downloads; an `it_admin` imports a historical register with
 * one bad row. The stub (`attendanceStaffReportsModule`) runs the serializers' and services'
 * checks in the server's order with its sentences (L5); whether the server agrees, which rows a
 * scope reaches and what a report counts are the Django suite's and the live lane's job.
 */

const STAFF_ATTENDANCE_PATH = /\/staff-attendance$/;
const CHECK_OUT_PATH = /\/staff-attendance\/[^/]+:check-out$/;
const CORRECTIONS_PATH = /\/attendance-corrections$/;
const REPORT_PATH = /\/reports\/attendance-summary$/;
const IMPORT_PATH = /\/student-attendance-imports$/;

const imran = buildStaffMember({
  firstName: "Imran",
  lastName: "Siddiqui",
  employeeNumber: "EMP-001",
  userId: uuid(),
});
const noor = buildStaffMember({ firstName: "Noor", lastName: "Usman", employeeNumber: "EMP-002" });
const zainab = buildStaffMember({
  firstName: "Zainab",
  lastName: "Qureshi",
  employeeNumber: "EMP-003",
});

/** A fresh server per test, for the signed-in `user`. */
function stubStaffReports(mockApi: MockApi, options: AttendanceStaffReportsOptions) {
  const store = new AttendanceStaffReportsStore(options);
  mockApi.use(attendanceStaffReportsModule(store), jobsModule(store.jobsOptions()));
  return store;
}

test.describe("the staff register, as HR", () => {
  const hr = buildUser({
    id: uuid(),
    full_name: "Ayesha Khan",
    permissions: ATTENDANCE_HR_PERMISSIONS,
    roles: [buildRole({ slug: "hr_staff", name: "HR Staff", scope: "all" })],
  });
  test.use({ authUser: hr });

  test("marks two staff, checks one out, and asks for a correction on a locked row", async ({
    page,
    mockApi,
    staffAttendancePage,
    signedIn: _signedIn,
  }) => {
    const today = todayUtc();
    // Three days back is past §19's default lock window of 0 days: read-only, correctable.
    const pastDate = shiftIsoDate(today, -3);
    const store = stubStaffReports(mockApi, { user: hr, staff: [imran, noor, zainab] });
    const lockedRow = store.recordFor(zainab, pastDate, {
      status: "late",
      check_in_time: "08:40:00",
      check_out_time: "13:00:00",
    });
    store.records.push(lockedRow);
    await staffAttendancePage.goto();

    await expect(staffAttendancePage.tab("Register")).toHaveAttribute("aria-selected", "true");

    await staffAttendancePage.status(staffName(imran), "Present").click();
    await staffAttendancePage.checkIn(staffName(imran)).fill("07:55");
    const firstSave = page.waitForRequest((r) => isApiCall(r, "POST", STAFF_ATTENDANCE_PATH));
    await staffAttendancePage.save(staffName(imran)).click();

    expect((await firstSave).postDataJSON()).toEqual({
      staff_id: imran.id,
      attendance_date: today,
      status: "present",
      check_in_time: "07:55",
      check_out_time: null,
      remarks: null,
    });
    await expect(page.getByText(`Attendance saved for ${staffName(imran)}.`)).toBeVisible();

    await staffAttendancePage.status(staffName(noor), "Late").click();
    await staffAttendancePage.checkIn(staffName(noor)).fill("08:40");
    const secondSave = page.waitForRequest((r) => isApiCall(r, "POST", STAFF_ATTENDANCE_PATH));
    await staffAttendancePage.save(staffName(noor)).click();

    // The exact body: no `late_minutes`, which only the server computes.
    expect((await secondSave).postDataJSON()).toEqual({
      staff_id: noor.id,
      attendance_date: today,
      status: "late",
      check_in_time: "08:40",
      check_out_time: null,
      remarks: null,
    });
    await expect(page.getByText(`Attendance saved for ${staffName(noor)}.`)).toBeVisible();
    // A checked-in row offers Check out; Zainab, unmarked today, has nothing to check out of.
    await expect(staffAttendancePage.checkOut(staffName(noor))).toBeVisible();
    await expect(staffAttendancePage.checkOut(staffName(zainab))).toHaveCount(0);

    await staffAttendancePage.checkOut(staffName(imran)).click();
    await staffAttendancePage.checkOutTime.fill("13:30");
    const checkOut = page.waitForRequest((r) => isApiCall(r, "POST", CHECK_OUT_PATH));
    await staffAttendancePage.checkOutSubmit.click();

    // The exact body: the departure time alone, no `early_departure_minutes`.
    expect((await checkOut).postDataJSON()).toEqual({ check_out_time: "13:30" });
    await expect(page.getByText(`Check-out recorded for ${staffName(imran)}.`)).toBeVisible();
    await expect(staffAttendancePage.row(staffName(imran))).toContainText("Out at 13:30");
    await expect(staffAttendancePage.checkOut(staffName(imran))).toHaveCount(0);

    await staffAttendancePage.date.fill(pastDate);

    await expect(staffAttendancePage.row(staffName(zainab))).toContainText("Locked");
    await expect(staffAttendancePage.statusGroup(staffName(zainab))).toHaveCount(0);

    await staffAttendancePage.requestCorrection(staffName(zainab)).click();
    // A staff row has no remarks to correct.
    await expect(staffAttendancePage.correctionField("Remarks")).toHaveCount(0);
    await staffAttendancePage.correctionField("Check-in time").fill("08:05");
    await staffAttendancePage.correctionReason.fill("The gate log shows 08:05.");
    const correction = page.waitForRequest((r) => isApiCall(r, "POST", CORRECTIONS_PATH));
    await staffAttendancePage.correctionSubmit.click();

    expect((await correction).postDataJSON()).toEqual({
      staff_attendance_id: lockedRow.id,
      new_values: { check_in_time: "08:05" },
      reason: "The gate log shows 08:05.",
    });
    await expect(staffAttendancePage.correctionDialog).toBeHidden();
    expect(store.corrections).toEqual([
      expect.objectContaining({
        subject_type: "staff",
        staff_attendance_id: lockedRow.id,
        student_attendance_id: null,
        staff_name: staffName(zainab),
        employee_number: "EMP-003",
        old_values: { check_in_time: "08:40:00" },
        new_values: { check_in_time: "08:05:00" },
        requested_by_name: hr.full_name,
      }),
    ]);
    // A correction changes nothing until it is approved.
    await expect(staffAttendancePage.row(staffName(zainab))).toContainText("Late");
  });
});

test.describe("staff attendance, as a staff member without the mark key", () => {
  const self = buildUser({
    id: imran.userId ?? uuid(),
    full_name: staffName(imran),
    permissions: ATTENDANCE_STAFF_SELF_PERMISSIONS,
    roles: [buildRole({ slug: "teacher", name: "Teacher", scope: "own" })],
  });
  test.use({ authUser: self });

  test("sees only their own history, and no register", async ({
    mockApi,
    staffAttendancePage,
    signedIn: _signedIn,
  }) => {
    const day = shiftIsoDate(todayUtc(), -2);
    const store = stubStaffReports(mockApi, { user: self, staff: [imran, noor] });
    store.records.push(
      store.recordFor(imran, day, { status: "late", check_in_time: "08:25:00" }),
      store.recordFor(noor, day, { status: "absent" }),
    );
    await staffAttendancePage.goto();

    await expect(staffAttendancePage.historyRow(staffName(imran))).toContainText("Late");
    // `own` scope reaches only the rows of the staff member linked to this login.
    await expect(staffAttendancePage.historyRow(staffName(noor))).toHaveCount(0);
    await expect(staffAttendancePage.views).toHaveCount(0);
    await expect(staffAttendancePage.staffList).toHaveCount(0);
    expect(mockApi.countCalls("GET", "/staff-attendance/register")).toBe(0);
  });
});

test.describe("attendance reports", () => {
  test.use({
    authUser: buildUser({
      permissions: ATTENDANCE_REPORT_PERMISSIONS,
      roles: [buildRole({ slug: "principal", name: "Principal", scope: "all" })],
    }),
  });

  const grade5 = buildSchoolClass({ id: ORG_IDS.grade1, name: "Grade 5" });
  const sectionA = buildSection({ id: ORG_IDS.sectionA, name: "A", class_id: grade5.id });

  function summary(
    first: string,
    last: string,
    present: number,
    counted: number,
  ): ReportSeed<"student-summary"> {
    return {
      student_id: uuid(),
      first_name: first,
      last_name: last,
      admission_number: `ADM-${last.toUpperCase()}`,
      present_days: present,
      counted_days: counted,
      absent_days: counted - present,
      late_days: 0,
      leave_days: 0,
      attendance_rate: counted === 0 ? 0 : Math.round((present / counted) * 1000) / 10,
      section_id: sectionA.id,
    };
  }

  /** 80% and 60% are below 90 (and the first above the default 75); 95% is above both; a
   * student with no counted days is never a defaulter. */
  function stubReports(mockApi: MockApi, user: AttendanceStaffReportsOptions["user"]) {
    mockApi.use(schoolOrganizationModule({ classes: [grade5], sections: [sectionA] }));
    return stubStaffReports(mockApi, {
      user,
      reportRows: {
        "student-summary": [
          summary("Amna", "Raza", 8, 10),
          summary("Bilal", "Khan", 19, 20),
          summary("Sara", "Ali", 3, 5),
          summary("Zara", "Hussain", 0, 0),
        ],
      },
    });
  }

  test("a defaulters report at 90% lists the students below it", async ({
    page,
    mockApi,
    attendanceReportsPage,
    signedIn,
  }) => {
    stubReports(mockApi, signedIn);
    await attendanceReportsPage.goto();

    await attendanceReportsPage.pickReport("Defaulters");
    await attendanceReportsPage.threshold.fill("90");
    const request = page.waitForRequest((r) => isApiCall(r, "GET", REPORT_PATH));
    await attendanceReportsPage.run.click();

    const params = new URL((await request).url()).searchParams;
    expect(params.get("kind")).toBe("defaulters");
    expect(params.get("threshold")).toBe("90");
    await expect(attendanceReportsPage.row("Defaulters", "Amna Raza")).toContainText("80.0%");
    await expect(attendanceReportsPage.row("Defaulters", "Sara Ali")).toContainText("60.0%");
    await expect(attendanceReportsPage.row("Defaulters", "Bilal Khan")).toHaveCount(0);
    await expect(attendanceReportsPage.row("Defaulters", "Zara Hussain")).toHaveCount(0);
    await expect(page).toHaveURL(/threshold=90/);
  });

  test("exports the report on screen, threshold and all, and downloads the file", async ({
    page,
    mockApi,
    attendanceReportsPage,
    signedIn,
  }) => {
    const store = stubReports(mockApi, signedIn);
    // Storage signs the URL with `Content-Disposition: attachment`, which is what makes
    // Chromium emit the `download` event for a cross-origin link.
    await page.route(REPORT_EXPORT_GLOB, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers: { "content-disposition": 'attachment; filename="defaulters.xlsx"' },
        body: "PK",
      }),
    );
    // A link that names its report runs on arrival.
    await attendanceReportsPage.goto({ path: "/attendance/reports?kind=defaulters&threshold=90" });
    await expect(attendanceReportsPage.row("Defaulters", "Amna Raza")).toBeVisible();

    const exportRequest = page.waitForRequest((r) => isApiCall(r, "POST", REPORT_PATH));
    const downloadPromise = page.waitForEvent("download");
    await attendanceReportsPage.exportButton("XLSX").click();

    expect((await exportRequest).postDataJSON()).toMatchObject({
      kind: "defaulters",
      threshold: "90",
      format: "xlsx",
    });
    const download = await downloadPromise;
    expect(download.url()).toBe(store.files[0]?.downloadUrl);
    // The job rebuilt the inline report's rows: the threshold travelled with it.
    expect(store.exports).toEqual([expect.objectContaining({ format: "xlsx", rows: 2 })]);
  });
});

test.describe("the historical import, as an it_admin", () => {
  test.use({
    authUser: buildUser({
      permissions: ATTENDANCE_IMPORT_PERMISSIONS,
      roles: [buildRole({ slug: "it_admin", name: "IT Administrator", scope: "all" })],
    }),
  });

  test("imports a register's good rows and reports the bad one", async ({
    page,
    mockApi,
    attendanceRecordsPage,
    signedIn,
  }) => {
    const session = buildAcademicSession({ id: ORG_IDS.currentSession, name: "2026-27" });
    const grade5 = buildSchoolClass({ id: ORG_IDS.grade1, name: "Grade 5" });
    const sectionA = buildSection({
      id: ORG_IDS.sectionA,
      name: "A",
      class_id: grade5.id,
      campus_id: ORG_IDS.mainCampus,
    });
    const amna = { id: uuid(), name: "Amna Raza", admissionNumber: "ADM-001", rollNumber: "1" };
    const register = new AttendanceRegisterStore({
      session,
      sections: [
        {
          id: sectionA.id,
          name: sectionA.name,
          classId: grade5.id,
          className: grade5.name,
          campusId: ORG_IDS.mainCampus,
          students: [amna],
          classTeacher: false,
        },
      ],
    });
    const day = shiftIsoDate(todayUtc(), -2);
    const file = {
      name: "history.csv",
      text: [
        "admission_number,attendance_date,status,check_in_time",
        `ADM-001,${day},absent,`,
        `ADM-404,${day},present,`,
      ].join("\n"),
    };
    mockApi.use(
      schoolOrganizationModule({
        classes: [grade5],
        sections: [sectionA],
        academicSessions: [session],
      }),
      attendanceRegisterModule(register),
    );
    stubStaffReports(mockApi, {
      user: signedIn,
      register,
      importFiles: { [file.name]: file.text },
    });
    await attendanceRecordsPage.goto();
    // The role holds the import key alone: Records is reachable, but there is no table to load.
    await expect(attendanceRecordsPage.importOnlyNote).toBeVisible();
    await expect(attendanceRecordsPage.table).toHaveCount(0);

    await attendanceRecordsPage.importButton.click();
    // The current session is picked for the import to be filed under.
    await expect(attendanceRecordsPage.importSession).toContainText(session.name);
    await attendanceRecordsPage.importFileInput.setInputFiles({
      name: file.name,
      mimeType: "text/csv",
      buffer: Buffer.from(file.text),
    });
    const upload = page.waitForRequest((r) => isApiCall(r, "POST", IMPORT_PATH));
    await attendanceRecordsPage.importSubmit.click();
    await upload;

    await expect(attendanceRecordsPage.importSummary("1 imported")).toBeVisible();
    // The result's `failed` count is what the summary badge reads.
    await expect(attendanceRecordsPage.importSummary("1 failed")).toBeVisible();
    // Row 3 of the file: its header is row 1.
    await expect(
      attendanceRecordsPage.importErrorRow("No live student has this admission number."),
    ).toContainText("3");
    // The good row was filed under the picked session: the stub writes it only when the
    // upload names the session the student is enrolled in.
    expect(register.find(amna.id, day, null)).toMatchObject({
      status: "absent",
      source: "import",
      is_locked: true,
    });

    await page.keyboard.press("Escape");
    await expect(attendanceRecordsPage.table).toHaveCount(0);
  });
});
