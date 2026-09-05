import type { ApiClient } from "@schoolhub/api-client";
import {
  buildLiveAcademicSession,
  buildLiveCampus,
  buildLiveClass,
  buildLiveEmergencyContact,
  buildLiveGuardian,
  buildLiveSection,
  buildLiveStudent,
} from "@/data/live-factories";
import { expect } from "@/fixtures";

/**
 * Builds the preconditions a promotion batch needs, through the real API.
 *
 * A promotion batch is the one academics workflow with a deep prerequisite chain: a
 * batch exists only for students *actively enrolled* in a class for a session, and
 * `enroll_student` in turn refuses a student with no guardian and no emergency contact
 * (student-management §11), which execution then goes through again for the target
 * session. That is a dozen writes before the first thing worth asserting.
 *
 * Shared by `tests/live/api/academics-promotions.spec.ts` and the browser journey rather
 * than duplicated, and deliberately *not* built on `seed_e2e_data`'s baseline session and
 * class: executing a batch closes the source enrollment (`status = promoted`), so a
 * second run against the seeded rows would find no actively enrolled student and fail
 * with "No actively enrolled students in this class for that session" — a self-poisoning
 * fixture. Everything here is run-unique instead.
 *
 * Leaves the batch in `draft` with each row's target class and section assigned: the
 * §7.2 state machine (`:submit` → `:approve` → `:execute`) is what the callers assert,
 * so this stops exactly short of it.
 */
export interface PromotionBatchFixture {
  batchId: string;
  /** One row per enrolled student — exactly one here. */
  /** Decisions are addressed by student now, not by row id. */
  studentIds: string[];
  studentId: string;
  fromSessionId: string;
  toSessionId: string;
  fromClassId: string;
  /** Run-unique, so a UI listing many batches can be narrowed to this one. */
  fromClassName: string;
  toClassId: string;
  toSectionId: string;
}

interface Identified {
  id: string;
}

export async function seedPromotionBatch(client: ApiClient): Promise<PromotionBatchFixture> {
  const campus = (await client.post("/campuses", buildLiveCampus())).data as Identified;

  const fromSessionPayload = buildLiveAcademicSession();
  const fromSession = (await client.post("/academic-sessions", fromSessionPayload))
    .data as Identified;
  const toSession = (await client.post("/academic-sessions", buildLiveAcademicSession()))
    .data as Identified;

  const fromClassPayload = buildLiveClass();
  const fromClass = (await client.post("/classes", fromClassPayload)).data as Identified;
  const toClass = (await client.post("/classes", buildLiveClass())).data as Identified;

  const fromSection = (
    await client.post("/sections", {
      ...buildLiveSection(),
      class_id: fromClass.id,
      campus_id: campus.id,
    })
  ).data as Identified;
  const toSection = (
    await client.post("/sections", {
      ...buildLiveSection(),
      class_id: toClass.id,
      campus_id: campus.id,
    })
  ).data as Identified;

  const student = (await client.post("/students", { ...buildLiveStudent(), campus_id: campus.id }))
    .data as Identified;
  const guardian = (await client.post("/guardians", buildLiveGuardian())).data as Identified;
  await client.post(`/students/${student.id}/guardians`, {
    guardian_id: guardian.id,
    relationship: "mother",
  });
  await client.post(`/students/${student.id}/emergency-contacts`, buildLiveEmergencyContact());

  // The session's own start date, not today: `assert_date_in_session` rejects a date
  // outside the session window, and `farFutureSessionWindow()` puts every generated
  // session years away from today on purpose (see live-factories.ts).
  await client.post(`/students/${student.id}:enroll`, {
    academic_session_id: fromSession.id,
    class_id: fromClass.id,
    section_id: fromSection.id,
    enrollment_date: fromSessionPayload.start_date,
  });

  const created = await client.post("/student-promotions", {
    from_academic_session_id: fromSession.id,
    to_academic_session_id: toSession.id,
    class_id: fromClass.id,
  });
  expect(created.status).toBe(201);
  const batch = created.data as { batch_id: string; students: number };
  expect(batch.students).toBe(1);

  // The batch resource returns its decisions inline — no filtered row list.
  const detail = await client.get<{ decisions: { student_id: string; id: string }[] }>(
    `/student-promotions/${batch.batch_id}`,
  );
  expect(detail.data.decisions).toHaveLength(1);

  for (const row of detail.data.decisions) {
    // `decision` is re-sent, not left alone: `create_promotion_batch` proposes
    // `graduated` (with a null target class) whenever nothing sits above this class on
    // the level ladder, and `PromotionDecisionSerializer.validate` refuses a graduating
    // row that carries a target class. Sending both together makes the row's shape
    // independent of whatever other classes happen to exist in the tenant.
    await client.patch(`/student-promotions/${batch.batch_id}/decisions/${row.student_id}`, {
      decision: "promoted",
      to_class_id: toClass.id,
      to_section_id: toSection.id,
    });
  }

  return {
    batchId: batch.batch_id,
    studentIds: detail.data.decisions.map((row) => row.student_id),
    studentId: student.id,
    fromSessionId: fromSession.id,
    toSessionId: toSession.id,
    fromClassId: fromClass.id,
    fromClassName: fromClassPayload.name,
    toClassId: toClass.id,
    toSectionId: toSection.id,
  };
}
