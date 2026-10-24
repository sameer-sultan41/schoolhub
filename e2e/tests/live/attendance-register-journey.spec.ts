import { env } from "@/env";
import { expect, test } from "@/fixtures";
import { seedAttendanceRegister, todaysSession } from "@/lib/live-attendance-register";
import { E2E_CLASS_TEACHER_EMAIL } from "@/lib/seed-constants";

/**
 * Live lane — requires the real stack, seeded (`seed_e2e_data`; see
 * `tests/live/tenant-isolation.spec.ts`'s header for the run command).
 *
 * attendance.md §5.1 as one teacher at one register: the seeded class teacher signs in, opens
 * Attendance, then Register, picks today's section, marks it, submits, and finds the rows in
 * Records. What only the browser proves: that the register the screen asks for (by section and
 * date, no session named) is the roster the server holds for today, that the submission the
 * screen builds is one the server accepts, and that Records reads back what was written.
 *
 * **The identity is `all`-scoped**, unlike a production class teacher (`seed_e2e_data.py`'s
 * `E2E_CLASS_TEACHER_PERMISSIONS` header says why): the section is run-unique, so there is no
 * fixed section to make it the class teacher of. It has no Staff row either, so My registers is
 * empty and the register is reached through the Class and Section pickers. The `assigned` path
 * (a class teacher marking only their own section, and the slot teacher, substitute and campus
 * rules of period mode) is proven over HTTP in the Django suite
 * (`apps/attendance/tests/test_register_api.py`, `test_attendance_mode.py`).
 *
 * **The roster is enrolled in the seeded baseline session** (`todaysSession`), not the
 * scaffold's far-future one: the screen names no session, and the server reads the roster of
 * the session containing the date.
 *
 * Auth budget (`AuthEndpointThrottle`, e2e/AGENTS.md): **one** browser login and **no**
 * refresh. Every screen after the login is reached by a click (sidebar, then the Records tab),
 * never `page.goto`, so no cold navigation restores a session. The worker-scoped
 * `liveApiClient` that builds the roster adds no login of its own.
 *
 * Waits: nothing here polls. The submission is synchronous (alerts are queued, not awaited),
 * and Records is one list read, so the default 5 s expect covers each step (L6).
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("attendance register (real API, class teacher)", () => {
  test("a teacher marks today's register and finds it in Records", async ({
    page,
    loginPage,
    dashboardPage,
    attendanceRegisterPage,
    attendanceRecordsPage,
    liveApiClient,
  }) => {
    const session = await todaysSession(liveApiClient);
    const register = await seedAttendanceRegister(liveApiClient, session);
    const [first, absentee, last] = register.students;
    if (!first || !absentee || !last) throw new Error("expected a roster of three");

    // --- 1. Sign in and reach the register through the sidebar. ---
    await loginPage.goto();
    await loginPage.signIn({
      identifier: E2E_CLASS_TEACHER_EMAIL,
      password: env.LIVE_ADMIN_PASSWORD,
    });
    await expect(page).toHaveURL("/dashboard");
    // The permission-gated nav renders only after the dashboard's own data loads (the same
    // wait the timetable journey documents); the group shows only for an `attendance.*` holder.
    await expect(dashboardPage.heading).toBeVisible();
    await dashboardPage.navGroup("Attendance").click();
    await dashboardPage.navLink("Register").click();
    await expect(attendanceRegisterPage.heading).toBeVisible();

    // --- 2. Today's register, picked by class and section. ---
    await attendanceRegisterPage.pickRegister(register.className, register.sectionName);
    for (const student of register.students) {
      await expect(attendanceRegisterPage.statusGroup(student.name)).toBeVisible();
    }

    // --- 3. Mark it: everyone present but one, and submit. ---
    await attendanceRegisterPage.markAllPresent.click();
    await attendanceRegisterPage.status(absentee.name, "Absent").click();
    await attendanceRegisterPage.submit.click();

    // One absence, so one guardian alert queued; nobody was marked before.
    await expect(
      page.getByText("Register saved: 3 marked, 0 updated, 1 guardian alert queued."),
    ).toBeVisible();

    // --- 4. The rows read back in Records, a fresh list read from the database. ---
    await dashboardPage.sectionTab("Records", "Attendance").click();
    await attendanceRecordsPage.filterToSection(register.className, register.sectionName);
    await expect(attendanceRecordsPage.row(absentee.name)).toContainText("Absent");
    await expect(attendanceRecordsPage.row(first.name)).toContainText("Present");
    await expect(attendanceRecordsPage.row(last.name)).toContainText("Present");
  });
});
