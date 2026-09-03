import { ApiError } from "@schoolhub/api-client";
import { buildLiveAcademicSession, buildLiveClass, buildLiveSubject } from "@/data/live-factories";
import { expect, test } from "@/fixtures";

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
    const created = await liveApiClient.post("/subjects", buildLiveSubject());
    expect(created.status).toBe(201);
    const subject = created.data as { id: string };

    const listed = await liveApiClient.get<Array<{ id: string }>>("/subjects");
    expect(listed.data.some((row) => row.id === subject.id)).toBe(true);

    const updated = await liveApiClient.patch(`/subjects/${subject.id}`, { is_active: false });
    expect((updated.data as { is_active: boolean }).is_active).toBe(false);

    const deleted = await liveApiClient.delete(`/subjects/${subject.id}`);
    expect(deleted.status).toBe(204);

    const afterDelete = await liveApiClient
      .get(`/subjects/${subject.id}`)
      .catch((error: unknown) => error);
    expect(afterDelete).toBeInstanceOf(ApiError);
    expect((afterDelete as ApiError).status).toBe(404);
  });
});

test.describe("class-subjects (live API)", () => {
  test("maps a subject to a class for a session, and rejects a duplicate mapping", async ({
    liveApiClient,
  }) => {
    const session = (await liveApiClient.post("/academic-sessions", buildLiveAcademicSession()))
      .data as { id: string };
    const schoolClass = (await liveApiClient.post("/classes", buildLiveClass())).data as {
      id: string;
    };
    const subject = (await liveApiClient.post("/subjects", buildLiveSubject())).data as {
      id: string;
    };

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
      academic_session_id: string;
      class_id: string;
      subject_id: string;
    };
    expect(classSubject.academic_session_id).toBe(session.id);
    expect(classSubject.class_id).toBe(schoolClass.id);
    expect(classSubject.subject_id).toBe(subject.id);

    const duplicate = await liveApiClient
      .post("/class-subjects", mapping)
      .catch((error: unknown) => error);
    expect(duplicate).toBeInstanceOf(ApiError);
    expect((duplicate as ApiError).status).toBe(409);
    expect((duplicate as ApiError).code).toBe("conflict");
  });
});
