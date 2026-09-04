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
 * Subjects and class-subjects share one file: `ClassSubjectViewSet` shares the
 * `subject.*` permission keys with `SubjectViewSet` (§4 declares no separate key), so
 * they're one permission surface, not two.
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

test.describe("class-subjects (live API)", () => {
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

      // Exercises ClassSubjectViewSet.perform_create's delegation to
      // services.map_subject_to_class end-to-end — the one place a raw serializer test
      // would not catch a wiring mistake between the view and the service.
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
