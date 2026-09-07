import { ApiError, type ApiClient } from "@schoolhub/api-client";
import { env } from "@/env";
import { expect, test } from "@/fixtures";
import { createLiveSession } from "@/lib/live-api";
import { seedAttendanceRegister, today } from "@/lib/live-attendance-register";
import { findSeededStaff } from "@/lib/live-timetable-grid";
import {
  E2E_BASELINE_TEACHER_EMPLOYEE_NUMBER,
  E2E_CLASS_TEACHER_EMAIL,
} from "@/lib/seed-constants";

/**
 * Live API lane — no browser. See campuses.spec.ts's header for the shared rationale.
 *
 * What this lane proves that the Django suite cannot: `staff_attendance`'s unique
 * constraint and RLS policy against real PostgreSQL under the NOSUPERUSER role, and
 * that a report's rows survive a real HTTP round trip with their record scope intact.
 *
 * **Staff attendance is marked for *today*, like the student register.** §11 refuses a
 * future date and §5.5 locks yesterday's, so there is one date this lane can write to —
 * and the constraint is one row per (staff, date), so the seeded teacher can be recorded
 * exactly once per run. The tests below therefore share one recording rather than each
 * making their own.
 *
 * Endpoints covered: `GET/POST /staff-attendance`, `POST /staff-attendance/{id}:check-out`,
 * `GET/POST /reports/attendance-summary`.
 */

interface Identified {
  id: string;
}

interface StaffAttendanceRow extends Identified {
  staff_id: string;
  status: string;
  source: string;
  late_minutes: number | null;
  early_departure_minutes: number | null;
}

async function markerSession(): Promise<ApiClient> {
  return createLiveSession({
    identifier: E2E_CLASS_TEACHER_EMAIL,
    password: env.LIVE_ADMIN_PASSWORD,
  });
}

test.describe("staff attendance (live API)", () => {
  test("a staff day is recorded, then checked out", async ({ liveApiClient }) => {
    const teacher = await findSeededStaff(liveApiClient, E2E_BASELINE_TEACHER_EMPLOYEE_NUMBER);
    const date = today();

    const created = await liveApiClient.post("/staff-attendance", {
      staff_id: teacher.id,
      attendance_date: date,
      status: "late",
      check_in_time: "08:35:00",
    });
    const row = created.data as StaffAttendanceRow;

    expect(row.status).toBe("late");
    // Computed server-side against the tenant day window (§11) — nothing was sent.
    expect(row.late_minutes).toBeGreaterThan(0);
    // Recorded *by an admin about someone else*, so not a self check-in (§5.2).
    expect(row.source).toBe("manual");

    const checkedOut = await liveApiClient.post(`/staff-attendance/${row.id}:check-out`, {
      check_out_time: "12:30:00",
    });

    expect((checkedOut.data as StaffAttendanceRow).early_departure_minutes).toBeGreaterThan(0);
  });

  test("a second row for the same staff member and date is refused", async ({ liveApiClient }) => {
    /* One plain unique constraint, unlike the student table's two partial ones:
     * a staff day is never per period. This is the index, not a service check —
     * which is why it belongs in the lane that runs against real PostgreSQL. */
    const teacher = await findSeededStaff(liveApiClient, E2E_BASELINE_TEACHER_EMPLOYEE_NUMBER);

    const error = await liveApiClient
      .post("/staff-attendance", {
        staff_id: teacher.id,
        attendance_date: today(),
        status: "present",
      })
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    // The first test in this file already recorded this teacher today, so this is
    // the upsert path (200) or a conflict — never a duplicate row.
    if (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect([409, 422]).toContain((error as ApiError).status);
    }

    const list = await liveApiClient.get(
      `/staff-attendance?staff_id=${teacher.id}&date=${today()}`,
    );
    expect(list.data as StaffAttendanceRow[]).toHaveLength(1);
  });
});

test.describe("attendance reports (live API)", () => {
  test("a summary reports the rows a register wrote", async ({ liveApiClient }) => {
    const register = await seedAttendanceRegister(liveApiClient);
    const marker = await markerSession();
    const date = today();

    await marker.post("/student-attendance:bulk-mark", {
      section_id: register.sectionId,
      academic_session_id: register.sessionId,
      attendance_date: date,
      entries: register.studentIds.map((id, index) => ({
        student_id: id,
        status: index === 0 ? "absent" : "present",
      })),
    });

    const report = await liveApiClient.get(
      `/reports/attendance-summary?kind=student-summary&start_date=${date}&section_id=${register.sectionId}`,
    );

    expect(report.meta).toMatchObject({ kind: "student-summary" });
    const rows = report.data as { student_id: string; attendance_rate: string }[];
    expect(rows).toHaveLength(register.studentIds.length);
    // One absent of three: the others are at 100%, the absentee at 0%.
    expect(rows.filter((row) => row.attendance_rate === "0.0")).toHaveLength(1);
  });

  test("the daily register needs only a start date", async ({ liveApiClient }) => {
    const register = await seedAttendanceRegister(liveApiClient);

    const report = await liveApiClient.get(
      `/reports/attendance-summary?kind=daily-register&start_date=${today()}&section_id=${register.sectionId}`,
    );

    expect(report.meta).toMatchObject({ kind: "daily-register" });
  });

  test("an export returns a job rather than the bytes", async ({ liveApiClient }) => {
    /* §4 keys export separately, so it is a deliberate act with its own
     * permission — not "the same report, but bigger". Always 202, however small. */
    const accepted = await liveApiClient.post("/reports/attendance-summary", {
      kind: "student-summary",
      start_date: today(),
    });

    const job = accepted.data as { job_id: string; status: string };
    expect(job.job_id).toBeTruthy();
    expect(job.status).toBe("queued");

    const polled = await liveApiClient.get(`/jobs/${job.job_id}`);
    expect((polled.data as { id: string }).id).toBe(job.job_id);
  });

  test("an unknown report kind is refused", async ({ liveApiClient }) => {
    const error = await liveApiClient
      .get(`/reports/attendance-summary?kind=invented&start_date=${today()}`)
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
  });
});
