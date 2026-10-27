import { ApiError, type ApiClient } from "@schoolhub/api-client";
import { env } from "@/env";
import { expect, test } from "@/fixtures";
import { createLiveSession } from "@/lib/live-api";
import {
  daysFromToday,
  seedAttendanceRegister,
  today,
  todaysSession,
} from "@/lib/live-attendance-register";
import { awaitJobResult } from "@/lib/live-jobs";
import { createLiveStaff } from "@/lib/live-staff-attendance";
import { findSeededStaff } from "@/lib/live-timetable-grid";
import {
  E2E_BASELINE_TEACHER_EMPLOYEE_NUMBER,
  E2E_CLASS_TEACHER_EMAIL,
  E2E_SCHOOL_ADMIN_EMAIL,
  MAX_LOCK_WINDOW_DAYS,
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
 * The staff register and the staff correction use a run-unique staff member instead
 * (`createLiveStaff`): the register's joining-date rule needs a member who joined today, and a
 * correction needs a locked row, which only a past date gives — written once per (staff, date).
 *
 * Endpoints covered: `GET/POST /staff-attendance`, `GET /staff-attendance/register`,
 * `POST /staff-attendance/{id}:check-out`, `POST /attendance-corrections` (staff target) and its
 * `:approve`, `GET/POST /reports/attendance-summary`.
 *
 * Logins: the class teacher once (the summary's marker) and the school admin once (the staff
 * correction's approver, a second identity §11 requires); everything else is the worker's
 * shared `liveApiClient`.
 */

/** Days the threshold report spans: enough for 80% and 60% to be reachable. */
const ATTENDANCE_DAYS = 5;

interface Identified {
  id: string;
}

interface StaffAttendanceRow extends Identified {
  staff_id: string;
  status: string;
  source: string;
  check_in_time: string | null;
  check_out_time: string | null;
  late_minutes: number | null;
  early_departure_minutes: number | null;
  is_locked: boolean;
}

interface StaffRegisterEntry {
  staff_id: string;
  staff_name: string;
  employee_number: string;
  record: StaffAttendanceRow | null;
  on_leave: boolean;
}

interface CorrectionRow extends Identified {
  subject_type: string;
  staff_attendance_id: string | null;
  student_attendance_id: string | null;
  status: string;
}

interface DefaulterRow {
  kind: string;
  student_id: string;
  attendance_rate: number;
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

  test("the register lists the staff who had joined by its date, with the day's record", async ({
    liveApiClient,
  }) => {
    const date = today();
    const joiner = await createLiveStaff(liveApiClient, { joining_date: date });
    const entryOn = async (on: string) => {
      const register = await liveApiClient.get<StaffRegisterEntry[]>("/staff-attendance/register", {
        query: { date: on },
      });
      return register.data.find((entry) => entry.staff_id === joiner.id);
    };

    // Not yet joined yesterday: a past register is not padded with later hires.
    expect(await entryOn(daysFromToday(-1))).toBeUndefined();
    expect(await entryOn(date)).toMatchObject({
      staff_name: `${joiner.first_name} ${joiner.last_name}`,
      employee_number: joiner.employee_number,
      record: null,
      on_leave: false,
    });

    await liveApiClient.post("/staff-attendance", {
      staff_id: joiner.id,
      attendance_date: date,
      status: "present",
      check_in_time: "08:00:00",
    });

    expect((await entryOn(date))?.record).toMatchObject({
      status: "present",
      source: "manual",
      is_locked: false,
    });
  });

  test("a staff correction recomputes the minutes once another person approves it", async ({
    liveApiClient,
  }) => {
    const member = await createLiveStaff(liveApiClient);
    const date = daysFromToday(-(MAX_LOCK_WINDOW_DAYS + 1));
    // A first row for a past date is accepted; it is locked as soon as it is written.
    const marked = (
      await liveApiClient.post<StaffAttendanceRow>("/staff-attendance", {
        staff_id: member.id,
        attendance_date: date,
        status: "late",
        check_in_time: "08:40:00",
        check_out_time: "12:30:00",
      })
    ).data;
    expect(marked.is_locked).toBe(true);

    const raised = (
      await liveApiClient.post<CorrectionRow>("/attendance-corrections", {
        staff_attendance_id: marked.id,
        new_values: { check_in_time: "08:25", check_out_time: "13:00" },
        reason: "The gate log shows an earlier arrival and a later departure.",
      })
    ).data;
    expect(raised).toMatchObject({
      subject_type: "staff",
      staff_attendance_id: marked.id,
      student_attendance_id: null,
      status: "pending",
    });

    // The requester may not decide their own request (§11): a second identity approves.
    const approver = await createLiveSession({
      identifier: E2E_SCHOOL_ADMIN_EMAIL,
      password: env.LIVE_ADMIN_PASSWORD,
    });
    const approved = await approver.post<CorrectionRow>(
      `/attendance-corrections/${raised.id}:approve`,
      {},
    );
    expect(approved.data.status).toBe("approved");

    const listed = await liveApiClient.get<StaffAttendanceRow[]>("/staff-attendance", {
      query: { staff_id: member.id, date },
    });
    const corrected = listed.data[0];
    expect(corrected).toMatchObject({
      status: "late",
      check_in_time: "08:25:00",
      check_out_time: "13:00:00",
    });
    // Recomputed by the server, not carried over: 15 minutes earlier in, 30 minutes later out.
    expect(corrected?.late_minutes).toBe((marked.late_minutes ?? 0) - 15);
    expect(corrected?.early_departure_minutes).toBe((marked.early_departure_minutes ?? 0) - 30);
  });
});

test.describe("attendance reports (live API)", () => {
  test("a summary reports the rows a register wrote", async ({ liveApiClient }) => {
    // Today's session: `:bulk-mark` refuses a session that does not contain the date.
    const session = await todaysSession(liveApiClient);
    const register = await seedAttendanceRegister(liveApiClient, session);
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
    const rows = report.data as { student_id: string; attendance_rate: string | number }[];
    expect(rows).toHaveLength(register.studentIds.length);
    // One absent of three: the others are at 100%, the absentee at 0%. A decimal comes back as
    // "0.0" or "0.00" depending on its serialisation, so compare the number, not the text.
    expect(rows.filter((row) => Number(row.attendance_rate) === 0)).toHaveLength(1);
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

  test("a defaulters export at a threshold has the inline report's rows", async ({
    liveApiClient,
  }) => {
    const session = await todaysSession(liveApiClient);
    const firstDay = daysFromToday(-(ATTENDANCE_DAYS - 1));
    // Enrolled from the first marked day, in the session whose dates contain all five days.
    const register = await seedAttendanceRegister(liveApiClient, {
      ...session,
      enrollmentDate: firstDay,
    });
    const [oneAbsence, steady, twoAbsences] = register.studentIds;
    if (!oneAbsence || !steady || !twoAbsences) throw new Error("expected a roster of three");
    const absences: Record<string, number> = { [oneAbsence]: 1, [twoAbsences]: 2 };

    // Five days, oldest first: 4/5 = 80%, 5/5 = 100% and 3/5 = 60%. A past day is a first
    // marking of an unmarked register, which `:bulk-mark` accepts past the lock window.
    // Marked by the shared admin session: the marking is set-up here, not under test.
    for (let back = ATTENDANCE_DAYS - 1; back >= 0; back -= 1) {
      const dayIndex = ATTENDANCE_DAYS - 1 - back;
      await liveApiClient.post("/student-attendance:bulk-mark", {
        section_id: register.sectionId,
        academic_session_id: register.sessionId,
        attendance_date: daysFromToday(-back),
        entries: register.studentIds.map((id) => ({
          student_id: id,
          status: dayIndex < (absences[id] ?? 0) ? "absent" : "present",
        })),
      });
    }

    const params = (threshold: string) =>
      `kind=defaulters&start_date=${firstDay}&end_date=${today()}` +
      `&section_id=${register.sectionId}&threshold=${threshold}`;
    const inline = await liveApiClient.get(`/reports/attendance-summary?${params("90")}`);
    const rows = inline.data as DefaulterRow[];

    expect(rows.map((row) => row.student_id).sort()).toEqual([oneAbsence, twoAbsences].sort());
    expect(rows.find((row) => row.student_id === oneAbsence)).toMatchObject({
      kind: "defaulters",
      attendance_rate: 80,
    });
    // The threshold decides the rows: at 70 the 80% student is not a defaulter.
    const lower = await liveApiClient.get(`/reports/attendance-summary?${params("70")}`);
    expect((lower.data as DefaulterRow[]).map((row) => row.student_id)).toEqual([twoAbsences]);

    const accepted = await liveApiClient.post("/reports/attendance-summary", {
      kind: "defaulters",
      start_date: firstDay,
      end_date: today(),
      section_id: register.sectionId,
      threshold: "90",
      format: "csv",
    });
    const result = await awaitJobResult<{ rows: number; format: string; attendance_mode: string }>(
      liveApiClient,
      (accepted.data as { job_id: string }).job_id,
    );

    // The job rebuilt the report with the same threshold: as many rows as the inline one, in the
    // mode the inline one reported.
    expect(result).toMatchObject({
      rows: rows.length,
      format: "csv",
      attendance_mode: (inline.meta as { attendance_mode: string }).attendance_mode,
    });
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
