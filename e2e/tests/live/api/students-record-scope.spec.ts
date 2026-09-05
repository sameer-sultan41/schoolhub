import { env } from "@/env";
import { expect, test } from "@/fixtures";
import { createLiveSession } from "@/lib/live-api";
import { E2E_STUDENT_EMAIL } from "@/lib/seed-constants";

/**
 * Live API lane — no browser, no UI: there is no student-facing dashboard route anywhere
 * in `apps/dashboard` (confirmed — only staff routes exist today), so this follows
 * `campuses.spec.ts`'s no-UI pattern instead.
 *
 * This is deliberately the *student self-view* case ("can a student see their own
 * profile, and only their own"), not "guardian sees own child". That second case isn't
 * actually implemented: `core/rbac/permissions.py`'s `scope_queryset` only filters
 * `RecordScope.OWN` on `Student.user_id == request.user.pk` — it never joins through
 * `StudentGuardian` to a guardian's linked children. A future session can pick this up
 * directly from that citation without re-deriving the diagnosis. This spec proves the
 * same architectural point (record scope actually filters, not just the permission key)
 * through the path that's real today.
 *
 * `seed_e2e_data` seeds two students on the same tenant: "E2E Student A", linked via
 * `user_id` to the seeded `student`-role user this spec logs in as, and "E2E Student B",
 * unlinked — what that user must never be able to see.
 */
test.describe("students record scope (live API, student role)", () => {
  test("a student sees only their own record, and gets 404 (not 403) on another's", async ({
    liveApiClient,
  }) => {
    const studentClient = await createLiveSession({
      identifier: E2E_STUDENT_EMAIL,
      password: env.LIVE_ADMIN_PASSWORD,
    });

    const list = await studentClient.get("/students");
    const students = list.data as { id: string; admission_number: string }[];
    expect(students).toHaveLength(1);
    const [ownStudent] = students;
    if (!ownStudent) throw new Error("expected the student's own seeded row to exist");
    expect(ownStudent.admission_number).toBe("E2E-STUDENT-A");
    const ownId = ownStudent.id;

    const own = await studentClient.get(`/students/${ownId}`);
    expect((own.data as { admission_number: string }).admission_number).toBe("E2E-STUDENT-A");

    // A real second student on the same tenant, found via `liveApiClient` (the worker's
    // shared `school_owner` session, which can see every record) — proves the boundary
    // against a real row, not a guessed/placeholder id.
    const allStudents = await liveApiClient.get("/students", {
      query: { search: "E2E-STUDENT-B" },
    });
    const other = (allStudents.data as { id: string; admission_number: string }[]).find(
      (student) => student.admission_number === "E2E-STUDENT-B",
    );
    if (!other) throw new Error("expected the seeded E2E-STUDENT-B row to exist");

    await expect(studentClient.get(`/students/${other.id}`)).rejects.toMatchObject({
      status: 404,
    });
  });
});
