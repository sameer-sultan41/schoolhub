import { ApiError, type ApiClient } from "@schoolhub/api-client";
import { env } from "@/env";
import { expect, test } from "@/fixtures";
import { createLiveSession } from "@/lib/live-api";
import { seedAttendanceRegister, today, todaysSession } from "@/lib/live-attendance-register";
import { E2E_CLASS_TEACHER_EMAIL } from "@/lib/seed-constants";

/**
 * Live API lane — no browser. See campuses.spec.ts's header for the shared rationale
 * (real HTTP contract only; field-level validation stays at the Django level, here
 * `apps/api/apps/attendance/tests/`).
 *
 * What this lane proves that the Django suite cannot: the two partial unique indexes on
 * `student_attendance` and the RLS policy over it, against a real PostgreSQL with a
 * NOSUPERUSER role, through a real HTTP round trip. Everything below is shaped by three
 * facts about the module:
 *
 * - **The register is marked for *today*.** §11 refuses a future date and §5.5 locks
 *   yesterday's, so there is exactly one date this lane can write to, which is why the
 *   fixture builds a run-unique section (see `seedAttendanceRegister`'s header).
 * - **Re-submitting is not an error.** §6 makes marking idempotent per (student, date,
 *   period), so the second submission below asserts `meta.updated`, not a 409 — a
 *   register that failed on retry is the bug this shape exists to prevent.
 * - **A rejected row rejects the whole submission.** Partial success is reported through
 *   `error.meta.rows` rather than committed, so the assertion is on the envelope *and*
 *   on nothing having been written.
 *
 * **Two identities, deliberately.** The fixture is built by `liveApiClient` (the
 * seeded school admin, which holds the structure and enrolment keys), but every
 * `:bulk-mark` runs as the seeded class teacher — §4 grants
 * `attendance.student-attendance.mark` to `teacher`/`class_teacher` and to nobody
 * else, and widening the admin fixture to hold it would let this lane assert a
 * permission the module does not actually grant.
 *
 * Endpoints covered: `GET /student-attendance`, `POST /student-attendance:bulk-mark`,
 * `GET /student-attendance/register` and `GET /student-attendance/my-registers`. The register
 * is read the way the dashboard reads it, by section and date only, so its roster is enrolled
 * in the session containing today (`todaysSession`).
 * The correction flow needs a *locked* row, which needs a date this lane cannot reach —
 * it is covered in the Django suite (`apps/attendance/tests/test_api.py`) and noted here
 * rather than faked with a hand-set `is_locked`, which no endpoint exposes.
 */

interface RegisterEntry {
  student_id: string;
  record: AttendanceRow | null;
  on_leave: boolean;
}

interface AttendanceRow {
  id: string;
  student_id: string;
  status: string;
  is_locked: boolean;
  late_minutes: number | null;
}

let markerLogin: Promise<ApiClient> | undefined;

/**
 * The class teacher's session, one login per worker rather than per test: four tests here
 * would otherwise spend four of `AuthEndpointThrottle`'s 10 a minute (e2e/AGENTS.md). Safe to
 * share for the reason `liveApiClient` is: a raw fetch session, whose cookie nothing rotates.
 */
async function markerSession(): Promise<ApiClient> {
  markerLogin ??= createLiveSession({
    identifier: E2E_CLASS_TEACHER_EMAIL,
    password: env.LIVE_ADMIN_PASSWORD,
  });
  return markerLogin;
}

test.describe("attendance marking (live API)", () => {
  test("a register is marked, re-submitted idempotently, and readable back", async ({
    liveApiClient,
  }) => {
    const register = await seedAttendanceRegister(liveApiClient);
    const marker = await markerSession();
    const date = today();
    const entries = register.studentIds.map((id, index) => ({
      student_id: id,
      status: index === 0 ? "absent" : "present",
    }));

    const first = await marker.post("/student-attendance:bulk-mark", {
      section_id: register.sectionId,
      academic_session_id: register.sessionId,
      attendance_date: date,
      entries,
    });

    expect(first.meta).toMatchObject({ marked: entries.length, updated: 0 });

    // The same register again — a teacher's phone retrying, which §6 requires to
    // succeed rather than collide with `student_attendance_one_per_day`.
    const second = await marker.post("/student-attendance:bulk-mark", {
      section_id: register.sectionId,
      academic_session_id: register.sessionId,
      attendance_date: date,
      entries,
    });

    expect(second.meta).toMatchObject({ marked: 0, updated: entries.length });

    const list = await marker.get(
      `/student-attendance?section_id=${register.sectionId}&date=${date}`,
    );
    const rows = list.data as AttendanceRow[];
    expect(rows).toHaveLength(entries.length);
    expect(rows.filter((row) => row.status === "absent")).toHaveLength(1);
    // Computed server-side and never client-supplied (§11) — nothing was sent for it.
    expect(rows.every((row) => row.late_minutes === null)).toBe(true);
  });

  test("the register reads today's roster, and a submission merges into it", async ({
    liveApiClient,
  }) => {
    const session = await todaysSession(liveApiClient);
    const register = await seedAttendanceRegister(liveApiClient, session);
    const marker = await markerSession();
    const date = today();
    const path = `/student-attendance/register?section_id=${register.sectionId}&date=${date}`;

    const before = await marker.get(path);
    const roster = before.data as RegisterEntry[];
    expect(roster.map((entry) => entry.student_id).sort()).toEqual([...register.studentIds].sort());
    expect(roster.every((entry) => entry.record === null && !entry.on_leave)).toBe(true);
    // The lock is per row, so `markable` speaks for the date alone: today, a working day.
    expect(before.meta).toMatchObject({
      attendance_mode: "daily",
      markable: true,
      unmarkable_reason: null,
      academic_session_id: register.sessionId,
    });

    await marker.post("/student-attendance:bulk-mark", {
      section_id: register.sectionId,
      academic_session_id: before.meta?.academic_session_id,
      attendance_date: date,
      period_id: null,
      entries: register.studentIds.map((id) => ({ student_id: id, status: "present" })),
    });

    const after = (await marker.get(path)).data as RegisterEntry[];
    expect(after.every((entry) => entry.record?.status === "present")).toBe(true);
    expect(after.every((entry) => entry.record?.is_locked === false)).toBe(true);

    // `my-registers` lists the sections the caller's own Staff rows class-teach or teach that
    // day. The seeded class teacher is `all`-scoped and has no Staff row, so it lists none and
    // the teacher opens a register through the pickers; the listing itself is pinned in
    // `tests/test_register_api.py` (MyRegistersTests).
    const mine = await marker.get(`/student-attendance/my-registers?date=${date}`);
    expect(mine.data).toEqual([]);
    expect(mine.meta).toMatchObject({ attendance_mode: "daily", date });
  });

  test("a student outside the section fails the submission and writes nothing", async ({
    liveApiClient,
  }) => {
    const register = await seedAttendanceRegister(liveApiClient);
    const outsider = await seedAttendanceRegister(liveApiClient);
    const marker = await markerSession();
    const date = today();
    const [strangerId] = outsider.studentIds;
    if (!strangerId) throw new Error("expected the second register to have a roster");

    const error = await marker
      .post("/student-attendance:bulk-mark", {
        section_id: register.sectionId,
        academic_session_id: register.sessionId,
        attendance_date: date,
        entries: [
          ...register.studentIds.map((id) => ({ student_id: id, status: "present" })),
          { student_id: strangerId, status: "present" },
        ],
      })
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);

    const list = await marker.get(
      `/student-attendance?section_id=${register.sectionId}&date=${date}`,
    );
    expect(list.data as AttendanceRow[]).toHaveLength(0);
  });

  test("marking a future date is refused", async ({ liveApiClient }) => {
    const register = await seedAttendanceRegister(liveApiClient);
    const marker = await markerSession();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const error = await marker
      .post("/student-attendance:bulk-mark", {
        section_id: register.sectionId,
        academic_session_id: register.sessionId,
        attendance_date: tomorrow.toISOString().slice(0, 10),
        entries: register.studentIds.map((id) => ({ student_id: id, status: "present" })),
      })
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
  });
});
