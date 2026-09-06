import { ApiError } from "@schoolhub/api-client";
import { expect, test } from "@/fixtures";
import { seedAttendanceRegister, today } from "@/lib/live-attendance-register";

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
 * Endpoints covered: `GET /student-attendance`, `POST /student-attendance:bulk-mark`.
 * The correction flow needs a *locked* row, which needs a date this lane cannot reach —
 * it is covered in the Django suite (`apps/attendance/tests/test_api.py`) and noted here
 * rather than faked with a hand-set `is_locked`, which no endpoint exposes.
 */

interface AttendanceRow {
  id: string;
  student_id: string;
  status: string;
  is_locked: boolean;
  late_minutes: number | null;
}

test.describe("attendance marking (live API)", () => {
  test("a register is marked, re-submitted idempotently, and readable back", async ({
    liveApiClient,
  }) => {
    const register = await seedAttendanceRegister(liveApiClient);
    const date = today();
    const entries = register.studentIds.map((id, index) => ({
      student_id: id,
      status: index === 0 ? "absent" : "present",
    }));

    const first = await liveApiClient.post("/student-attendance:bulk-mark", {
      section_id: register.sectionId,
      academic_session_id: register.sessionId,
      attendance_date: date,
      entries,
    });

    expect(first.meta).toMatchObject({ marked: entries.length, updated: 0 });

    // The same register again — a teacher's phone retrying, which §6 requires to
    // succeed rather than collide with `student_attendance_one_per_day`.
    const second = await liveApiClient.post("/student-attendance:bulk-mark", {
      section_id: register.sectionId,
      academic_session_id: register.sessionId,
      attendance_date: date,
      entries,
    });

    expect(second.meta).toMatchObject({ marked: 0, updated: entries.length });

    const list = await liveApiClient.get(
      `/student-attendance?section_id=${register.sectionId}&date=${date}`,
    );
    const rows = list.data as AttendanceRow[];
    expect(rows).toHaveLength(entries.length);
    expect(rows.filter((row) => row.status === "absent")).toHaveLength(1);
    // Computed server-side and never client-supplied (§11) — nothing was sent for it.
    expect(rows.every((row) => row.late_minutes === null)).toBe(true);
  });

  test("a student outside the section fails the submission and writes nothing", async ({
    liveApiClient,
  }) => {
    const register = await seedAttendanceRegister(liveApiClient);
    const outsider = await seedAttendanceRegister(liveApiClient);
    const date = today();
    const [strangerId] = outsider.studentIds;
    if (!strangerId) throw new Error("expected the second register to have a roster");

    const error = await liveApiClient
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

    const list = await liveApiClient.get(
      `/student-attendance?section_id=${register.sectionId}&date=${date}`,
    );
    expect(list.data as AttendanceRow[]).toHaveLength(0);
  });

  test("marking a future date is refused", async ({ liveApiClient }) => {
    const register = await seedAttendanceRegister(liveApiClient);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const error = await liveApiClient
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
