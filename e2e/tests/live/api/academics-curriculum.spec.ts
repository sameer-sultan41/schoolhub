import { ApiError } from "@schoolhub/api-client";
import { buildLiveAcademicSession, buildLiveClass, buildLiveSubject } from "@/data/live-factories";
import { expect, test } from "@/fixtures";

interface Identified {
  id: string;
}

interface CurriculumRow {
  id: string;
  academic_session_id: string;
  class_id: string;
  subject_id: string;
  campus_id: string | null;
  weekly_periods: number;
  is_elective: boolean;
}

/**
 * Live API lane — no browser, no UI. See campuses.spec.ts's header comment for the shared
 * rationale (real HTTP contract only; field-level validation stays at the Django unit
 * level, `apps/api/apps/academics/tests/test_api.py`).
 *
 * `/class-subjects` is served by `academics.CurriculumViewSet` under
 * `academics.curriculum.*` keys and the `module.academics` feature flag — it used to be
 * school_organization's under `school.subject.*`. `subjects.spec.ts` pins the key/flag
 * side of that move; this file covers the endpoint's own behaviour.
 *
 * Every fixture here is run-unique (its own session/class/subject) rather than the
 * seeded baseline curriculum row: `class_subjects_unique_mapping` makes a second run
 * against fixed rows a 409, and clone counts would drift with whatever earlier runs left
 * in the tenant.
 */
test.describe("class-subjects (live API)", () => {
  test("supports the full create/read/update/delete lifecycle", async ({ liveApiClient }) => {
    const [session, schoolClass, subject] = await Promise.all([
      liveApiClient
        .post("/academic-sessions", buildLiveAcademicSession())
        .then((r) => r.data as Identified),
      liveApiClient.post("/classes", buildLiveClass()).then((r) => r.data as Identified),
      liveApiClient.post("/subjects", buildLiveSubject()).then((r) => r.data as Identified),
    ]);

    const created = await liveApiClient.post("/class-subjects", {
      academic_session_id: session.id,
      class_id: schoolClass.id,
      subject_id: subject.id,
      weekly_periods: 4,
    });
    expect(created.status).toBe(201);
    const row = created.data as CurriculumRow;
    expect(row.academic_session_id).toBe(session.id);
    expect(row.weekly_periods).toBe(4);
    // Campus-agnostic by default — "null means the mapping applies to every campus"
    // (ClassSubject.campus's own help text), which is also what makes the unique
    // constraint's `nulls_distinct=False` load-bearing.
    expect(row.campus_id).toBeNull();

    // Filtered, not a bare list: `/class-subjects` accumulates across runs in a
    // persistent dev database and the model orders by uuid columns, so an unfiltered
    // page is not guaranteed to contain a just-created row. §16 names
    // `academic_session_id` as a supported filter, so this asserts the filter too.
    const listed = await liveApiClient.get<CurriculumRow[]>("/class-subjects", {
      query: { academic_session_id: session.id },
    });
    expect(listed.status).toBe(200);
    expect(listed.data.map((entry) => entry.id)).toContain(row.id);

    const updated = await liveApiClient.patch(`/class-subjects/${row.id}`, { weekly_periods: 6 });
    expect((updated.data as CurriculumRow).weekly_periods).toBe(6);

    const deleted = await liveApiClient.delete(`/class-subjects/${row.id}`);
    expect(deleted.status).toBe(204);

    const afterDelete = await liveApiClient
      .get(`/class-subjects/${row.id}`)
      .catch((error: unknown) => error);
    expect(afterDelete).toBeInstanceOf(ApiError);
    expect((afterDelete as ApiError).status).toBe(404);

    await liveApiClient.delete(`/classes/${schoolClass.id}`).catch(() => {});
  });

  test("a real curriculum row is 404 to another tenant's admin, never 403", async ({
    liveApiClient,
    liveOtherTenantApiClient,
  }) => {
    const [session, schoolClass, subject] = await Promise.all([
      liveApiClient
        .post("/academic-sessions", buildLiveAcademicSession())
        .then((r) => r.data as Identified),
      liveApiClient.post("/classes", buildLiveClass()).then((r) => r.data as Identified),
      liveApiClient.post("/subjects", buildLiveSubject()).then((r) => r.data as Identified),
    ]);
    const row = (
      await liveApiClient.post("/class-subjects", {
        academic_session_id: session.id,
        class_id: schoolClass.id,
        subject_id: subject.id,
      })
    ).data as Identified;

    try {
      // A real row and a real second identity, not a placeholder id under this tenant's
      // own session: 403 would confirm the row exists somewhere, which is precisely what
      // api-architecture.md §2.3 forbids a cross-tenant probe from learning. The other
      // tenant has `module.academics` enabled too (seed_e2e_data.py) — without that the
      // feature gate would answer 403 `module_disabled` before the row lookup ever ran,
      // and this test would pass for entirely the wrong reason.
      const probe = await liveOtherTenantApiClient
        .get(`/class-subjects/${row.id}`)
        .catch((error: unknown) => error);
      expect(probe).toBeInstanceOf(ApiError);
      expect((probe as ApiError).status).toBe(404);
      expect((probe as ApiError).code).toBe("not_found");
    } finally {
      await liveApiClient.delete(`/class-subjects/${row.id}`).catch(() => {});
      await liveApiClient.delete(`/classes/${schoolClass.id}`).catch(() => {});
    }
  });
});

test.describe("class-subjects:clone (live API)", () => {
  test("clones a session's curriculum, then skips rather than duplicating on a re-run", async ({
    liveApiClient,
  }) => {
    const [sourceSession, targetSession, schoolClass, subject] = await Promise.all([
      liveApiClient
        .post("/academic-sessions", buildLiveAcademicSession())
        .then((r) => r.data as Identified),
      liveApiClient
        .post("/academic-sessions", buildLiveAcademicSession())
        .then((r) => r.data as Identified),
      liveApiClient.post("/classes", buildLiveClass()).then((r) => r.data as Identified),
      liveApiClient.post("/subjects", buildLiveSubject()).then((r) => r.data as Identified),
    ]);
    const sourceRow = (
      await liveApiClient.post("/class-subjects", {
        academic_session_id: sourceSession.id,
        class_id: schoolClass.id,
        subject_id: subject.id,
        weekly_periods: 5,
      })
    ).data as Identified;

    const payload = {
      source_academic_session_id: sourceSession.id,
      target_academic_session_id: targetSession.id,
    };
    const clonedRowIds: string[] = [];

    try {
      const cloned = await liveApiClient.post("/class-subjects:clone", payload);
      expect(cloned.status).toBe(200);
      expect(cloned.data).toEqual({ created: 1, skipped: 0 });

      const inTarget = await liveApiClient.get<CurriculumRow[]>("/class-subjects", {
        query: { academic_session_id: targetSession.id },
      });
      expect(inTarget.data).toHaveLength(1);
      expect(inTarget.data[0]?.subject_id).toBe(subject.id);
      expect(inTarget.data[0]?.weekly_periods).toBe(5);
      clonedRowIds.push(...inTarget.data.map((entry) => entry.id));

      // No `Idempotency-Key` on either call, deliberately: this must prove
      // `clone_curriculum`'s own row-level skip (what makes the action converge for
      // good), not the 24h replay cache in front of it, which would return the first
      // response verbatim and prove nothing about the service.
      const again = await liveApiClient.post("/class-subjects:clone", payload);
      expect(again.data).toEqual({ created: 0, skipped: 1 });

      const afterSecondClone = await liveApiClient.get<CurriculumRow[]>("/class-subjects", {
        query: { academic_session_id: targetSession.id },
      });
      expect(afterSecondClone.data).toHaveLength(1);
    } finally {
      // Sessions have no destroy endpoint, so their curriculum rows are the only part of
      // this fixture that can be cleaned up — and the class cannot go until they have.
      for (const id of [...clonedRowIds, sourceRow.id]) {
        await liveApiClient.delete(`/class-subjects/${id}`).catch(() => {});
      }
      await liveApiClient.delete(`/classes/${schoolClass.id}`).catch(() => {});
    }
  });
});
