import { ApiError, type ApiClient } from "@schoolhub/api-client";
import {
  buildLiveAcademicSession,
  buildLiveCampus,
  buildLiveClass,
  buildLiveSection,
  buildLiveSubject,
} from "@/data/live-factories";
import { expect, test } from "@/fixtures";
import { E2E_BASELINE_TEACHER_EMPLOYEE_NUMBER } from "@/lib/seed-constants";

/**
 * Live API lane — no browser, no UI. See campuses.spec.ts's header comment for the shared
 * rationale (real HTTP contract only; field-level validation stays at the Django unit
 * level, `apps/api/apps/academics/tests/test_api.py`).
 *
 * An allocation is the most *pre-conditioned* write in academics: §11 requires the staff
 * member to be active teaching staff **and** the subject to already be in the section's
 * class curriculum for that session. Both are satisfied here — the teacher from the seed,
 * the curriculum built per test — because an allocation spec that cannot satisfy them can
 * only ever assert its own setup failing.
 *
 * The teacher is the one shared fixture: `Staff` ids are generated per seed run, so it is
 * found by its seeded employee number through `GET /staff` (behind `module.staff`, which
 * the seed enables for exactly this reason). Everything else is run-unique —
 * `tsa_unique_allocation` counts end-dated rows too, so re-running against a fixed
 * (session, section, subject, staff) tuple would 409 on the second run.
 */

interface Identified {
  id: string;
}

interface Allocation {
  id: string;
  academic_session_id: string;
  section_id: string;
  subject_id: string;
  staff_id: string;
  is_primary: boolean;
  weekly_periods: number | null;
  effective_to: string | null;
}

interface LoadSummaryRow {
  staff_id: string;
  name: string;
  weekly_periods: number;
  allocations: number;
  over_norm: boolean;
}

/** Weekly periods on the curriculum row — the load figure an allocation inherits. */
const CURRICULUM_WEEKLY_PERIODS = 4;

/** The seeded teaching staff member, by the one attribute that survives a re-seed. */
async function findSeededTeacher(client: ApiClient): Promise<Identified> {
  const staff = await client.get<{ id: string; employee_number: string }[]>("/staff", {
    query: { search: E2E_BASELINE_TEACHER_EMPLOYEE_NUMBER },
  });
  const teacher = staff.data.find(
    (row) => row.employee_number === E2E_BASELINE_TEACHER_EMPLOYEE_NUMBER,
  );
  if (!teacher) {
    throw new Error(
      `no seeded teacher ${E2E_BASELINE_TEACHER_EMPLOYEE_NUMBER} — run manage.py seed_e2e_data`,
    );
  }
  return teacher;
}

interface AllocationFixture {
  sessionId: string;
  sectionId: string;
  subjectId: string;
  staffId: string;
}

/** A session/class/section/subject chain with the subject already in the curriculum. */
async function setupSectionForAllocation(client: ApiClient): Promise<AllocationFixture> {
  const [campus, session, schoolClass, subject, teacher] = await Promise.all([
    client.post("/campuses", buildLiveCampus()).then((r) => r.data as Identified),
    client.post("/academic-sessions", buildLiveAcademicSession()).then((r) => r.data as Identified),
    client.post("/classes", buildLiveClass()).then((r) => r.data as Identified),
    client.post("/subjects", buildLiveSubject()).then((r) => r.data as Identified),
    findSeededTeacher(client),
  ]);

  const section = (
    await client.post("/sections", {
      ...buildLiveSection(),
      class_id: schoolClass.id,
      campus_id: campus.id,
    })
  ).data as Identified;

  await client.post("/class-subjects", {
    academic_session_id: session.id,
    class_id: schoolClass.id,
    subject_id: subject.id,
    weekly_periods: CURRICULUM_WEEKLY_PERIODS,
  });

  return {
    sessionId: session.id,
    sectionId: section.id,
    subjectId: subject.id,
    staffId: teacher.id,
  };
}

test.describe("teacher-subject-allocations (live API)", () => {
  test("allocates a teacher, reports their load, and deletes cleanly", async ({
    liveApiClient,
  }) => {
    const fixture = await setupSectionForAllocation(liveApiClient);

    const created = await liveApiClient.post("/teacher-subject-allocations", {
      academic_session_id: fixture.sessionId,
      section_id: fixture.sectionId,
      subject_id: fixture.subjectId,
      staff_id: fixture.staffId,
    });
    expect(created.status).toBe(201);
    // `TeacherAllocationViewSet.create` is the one academics write that answers with a
    // `meta` of its own: §11's load warnings ride there rather than rejecting the write,
    // so a grid being built up over norm is still savable. The shape asserted here is the
    // one `apps/api/apps/academics/tests/test_api.py` pins (`body["meta"]["warnings"]`,
    // the allocation itself in `data`). If this fails with the allocation nested one level
    // deeper, the view is wrapping an already-enveloped payload in `ActionResponse.ok`
    // again — fix the view, not this assertion.
    const allocation = created.data as Allocation;
    expect(allocation.section_id).toBe(fixture.sectionId);
    expect(allocation.staff_id).toBe(fixture.staffId);
    expect(allocation.is_primary).toBe(true);
    expect(allocation.effective_to).toBeNull();
    expect(created.meta?.warnings).toEqual([]);

    const listed = await liveApiClient.get<Allocation[]>("/teacher-subject-allocations", {
      query: { academic_session_id: fixture.sessionId },
    });
    expect(listed.data.map((row) => row.id)).toContain(allocation.id);

    // With no override on the allocation, the load comes from the curriculum row —
    // `weekly_load_by_staff` joins the two in memory rather than per allocation.
    const summary = await liveApiClient.get<LoadSummaryRow[]>(
      "/teacher-subject-allocations/load-summary",
      { query: { academic_session_id: fixture.sessionId } },
    );
    expect(summary.status).toBe(200);
    expect(summary.data).toHaveLength(1);
    const row = summary.data[0];
    if (!row) throw new Error("expected one load-summary row for the seeded teacher");
    expect(row.staff_id).toBe(fixture.staffId);
    expect(row.allocations).toBe(1);
    expect(row.weekly_periods).toBe(CURRICULUM_WEEKLY_PERIODS);
    expect(row.over_norm).toBe(false);

    // The override column exists so a teacher taking a subject at a non-standard
    // frequency does not distort the load maths — it must win over the curriculum target.
    await liveApiClient.patch(`/teacher-subject-allocations/${allocation.id}`, {
      weekly_periods: 9,
    });
    const overridden = await liveApiClient.get<LoadSummaryRow[]>(
      "/teacher-subject-allocations/load-summary",
      { query: { academic_session_id: fixture.sessionId } },
    );
    expect(overridden.data[0]?.weekly_periods).toBe(9);

    const deleted = await liveApiClient.delete(`/teacher-subject-allocations/${allocation.id}`);
    expect(deleted.status).toBe(204);
    const afterDelete = await liveApiClient
      .get(`/teacher-subject-allocations/${allocation.id}`)
      .catch((error: unknown) => error);
    expect(afterDelete).toBeInstanceOf(ApiError);
    expect((afterDelete as ApiError).status).toBe(404);
  });

  test("refuses a subject that is not in the section's class curriculum", async ({
    liveApiClient,
  }) => {
    const fixture = await setupSectionForAllocation(liveApiClient);
    const unrelated = (await liveApiClient.post("/subjects", buildLiveSubject()))
      .data as Identified;

    // §11: allocating to a section requires the subject to be in that class's curriculum.
    // Without it, timetable would schedule — and examinations would grade — a subject the
    // class never studies. This is a domain rule, so a 422 with the offending field named,
    // not a 400 from field validation.
    const refused = await liveApiClient
      .post("/teacher-subject-allocations", {
        academic_session_id: fixture.sessionId,
        section_id: fixture.sectionId,
        subject_id: unrelated.id,
        staff_id: fixture.staffId,
      })
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ApiError);
    const error = refused as ApiError;
    expect(error.status).toBe(422);
    expect(error.code).toBe("domain_rule_violation");
    expect(error.details.map((detail) => detail.field)).toContain("subject_id");
  });

  test("a real allocation is 404 to another tenant's admin, never 403", async ({
    liveApiClient,
    liveOtherTenantApiClient,
  }) => {
    const fixture = await setupSectionForAllocation(liveApiClient);
    const created = await liveApiClient.post("/teacher-subject-allocations", {
      academic_session_id: fixture.sessionId,
      section_id: fixture.sectionId,
      subject_id: fixture.subjectId,
      staff_id: fixture.staffId,
    });
    const allocation = created.data as Allocation;

    try {
      // Same reasoning as the curriculum spec's isolation test: a real row, a real second
      // identity, and `module.academics` enabled on both tenants so the feature gate
      // cannot answer first.
      const probe = await liveOtherTenantApiClient
        .get(`/teacher-subject-allocations/${allocation.id}`)
        .catch((error: unknown) => error);
      expect(probe).toBeInstanceOf(ApiError);
      expect((probe as ApiError).status).toBe(404);
      expect((probe as ApiError).code).toBe("not_found");
    } finally {
      await liveApiClient.delete(`/teacher-subject-allocations/${allocation.id}`).catch(() => {});
    }
  });
});
