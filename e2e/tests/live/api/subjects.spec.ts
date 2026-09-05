import { ApiError } from "@schoolhub/api-client";
import { buildLiveAcademicSession, buildLiveClass, buildLiveSubject } from "@/data/live-factories";
import { expect, test } from "@/fixtures";
import { runCrudLifecycle } from "@/lib/live-crud-lifecycle";

interface Subject {
  id: string;
  is_active: boolean;
}

/**
 * Live API lane — no browser, no UI. See campuses.spec.ts's header comment for the shared
 * rationale (real HTTP contract only; field validation stays at the Django unit level).
 *
 * Subjects only. `/class-subjects` used to live here because school_organization's
 * `ClassSubjectViewSet` shared the `school.subject.*` keys with `SubjectViewSet` — one
 * permission surface, one file. That is no longer true: academics.md §4 declares
 * `academics.curriculum.*` for curriculum mapping and school-organization.md §6 says the
 * mapping belongs to that module, so the endpoint moved to
 * `academics.CurriculumViewSet` — different keys, and behind `module.academics` rather
 * than `module.school`. The endpoint's own coverage moved with it, to
 * `academics-curriculum.spec.ts`.
 *
 * What stays here is the one thing the move itself is about: the *subject catalog* is
 * still school_organization's, under `school.subject.*`. The remaining class-subject test
 * below is the seam between the two modules — a subject created through this module's
 * endpoint is immediately mappable through the other's.
 */
test.describe("subjects (live API)", () => {
  test("supports the full create/read/update/delete lifecycle", async ({ liveApiClient }) => {
    await runCrudLifecycle<Subject>({
      liveApiClient,
      endpoint: "/subjects",
      build: buildLiveSubject,
      patch: { is_active: false },
      assertPatched: (subject) => {
        expect(subject.is_active).toBe(false);
      },
    });
  });
});

test.describe("class-subjects — the school_organization seam (live API)", () => {
  test("maps a subject to a class for a session, and rejects a duplicate mapping", async ({
    liveApiClient,
  }) => {
    const [sessionResponse, classResponse, subjectResponse] = await Promise.all([
      liveApiClient.post("/academic-sessions", buildLiveAcademicSession()),
      liveApiClient.post("/classes", buildLiveClass()),
      liveApiClient.post("/subjects", buildLiveSubject()),
    ]);
    const session = sessionResponse.data as { id: string };
    const schoolClass = classResponse.data as { id: string };
    const subject = subjectResponse.data as { id: string };

    let classSubjectId: string | undefined;
    try {
      const mapping = {
        academic_session_id: session.id,
        class_id: schoolClass.id,
        subject_id: subject.id,
        weekly_periods: 4,
      };

      // Exercises `academics.CurriculumViewSet.perform_create`'s delegation *back* to
      // school_organization's `services.map_subject_to_class` end-to-end — the one place
      // a raw serializer test would not catch a wiring mistake between the view and the
      // service, and the reason the duplicate below is a 409 from that service rather
      // than a 400 from the serializer. The endpoint is academics' now
      // (`academics.curriculum.*` + `module.academics`, not `school.subject.*` +
      // `module.school`), so a caller holding only the old keys is refused — see
      // `academics-curriculum.spec.ts` for the rest of its behaviour.
      const created = await liveApiClient.post("/class-subjects", mapping);
      expect(created.status).toBe(201);
      const classSubject = created.data as {
        id: string;
        academic_session_id: string;
        class_id: string;
        subject_id: string;
      };
      expect(classSubject.academic_session_id).toBe(session.id);
      expect(classSubject.class_id).toBe(schoolClass.id);
      expect(classSubject.subject_id).toBe(subject.id);
      classSubjectId = classSubject.id;

      const duplicate = await liveApiClient
        .post("/class-subjects", mapping)
        .catch((error: unknown) => error);
      expect(duplicate).toBeInstanceOf(ApiError);
      expect((duplicate as ApiError).status).toBe(409);
      expect((duplicate as ApiError).code).toBe("conflict");
    } finally {
      // Class has no time/sequence component to its randomized `level` and no spec
      // deletes what it creates otherwise — rows would accumulate forever in a
      // persistent database. Delete the class-subject mapping first: BlockingDestroyMixin
      // would otherwise 422 on a class that's still referenced.
      if (classSubjectId) {
        await liveApiClient.delete(`/class-subjects/${classSubjectId}`).catch(() => {});
      }
      await liveApiClient.delete(`/classes/${schoolClass.id}`).catch(() => {});
    }
  });
});
