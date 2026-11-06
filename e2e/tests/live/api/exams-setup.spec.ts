import { ApiError, type ApiClient } from "@schoolhub/api-client";
import { expect, test } from "@/fixtures";
import {
  allocateTeacher,
  createExamWithSubject,
  EXAM_SUBJECT_MAX_MARKS,
  EXAM_SUBJECT_PASS_MARKS,
  examStaffSession,
  seedExamScaffold,
  teacherLoginStaffId,
  teacherSession,
} from "@/lib/live-exams";
import { E2E_GRADING_SCALE_NAME } from "@/lib/seed-constants";

/**
 * Live API lane — no browser. See campuses.spec.ts's header for the shared rationale.
 *
 * Examinations setup (PR A): grading scales, exams and their subjects, against the real API and
 * the real record scope. Field-level validation stays in the Django suite
 * (`apps/api/apps/examinations/tests/`); this lane pins what only a real stack shows.
 *
 * **Three identities** (`@/lib/live-exams`): the worker's admin builds each run-unique scaffold
 * and the teacher's allocation; the seeded `exam_staff` writes the exams, so the real role's keys
 * are what is exercised; the seeded `teacher`, at `assigned` scope, proves the scope. Each is one
 * login per worker.
 *
 * Not here: the 409s for a write or delete past `draft`/`scheduled`. Nothing in PR A moves an
 * exam out of `draft`, so those are the Django suite's (`test_api.py`) until the schedule PR
 * gives the lane a way to publish one.
 *
 * Endpoints covered: `GET /grading-scales`, `GET /grading-scales/{id}/grade-bands`,
 * `GET/POST /exams`, `GET/DELETE /exams/{id}`, `GET/POST /exam-subjects`.
 */

interface Exam {
  id: string;
  name: string;
  status: string;
  academic_session_id: string;
  academic_session_name: string;
  term_name: string | null;
  grading_scale_name: string;
  subject_count: number;
}

interface ExamSubject {
  id: string;
  exam_name: string;
  class_name: string;
  subject_name: string;
  max_marks: string;
  pass_marks: string;
}

interface GradingScale {
  id: string;
  name: string;
  is_default: boolean;
  bands: unknown[];
}

interface GradeBand {
  label: string;
  sort_order: number;
}

/** The labels `seed_e2e_examinations.E2E_BANDS` writes, in their display order. */
const SEEDED_BAND_LABELS = ["A", "B", "C", "D", "F"];

async function refusal(request: Promise<unknown>): Promise<ApiError> {
  const outcome = await request.catch((error: unknown) => error);
  expect(outcome).toBeInstanceOf(ApiError);
  return outcome as ApiError;
}

/** `/exams?search=<name>` as `client`: the ids it returns. */
async function listedExamIds(client: ApiClient, name: string): Promise<string[]> {
  const listed = await client.get<Exam[]>("/exams", { query: { search: name } });
  return listed.data.map((row) => row.id);
}

test.describe("examinations setup (live API)", () => {
  test("exam staff build an exam, read it back by name, and delete the draft", async ({
    liveApiClient,
  }) => {
    const scaffold = await seedExamScaffold(liveApiClient);
    const examStaff = await examStaffSession();

    const { examId, examName, examSubjectId } = await createExamWithSubject(examStaff, scaffold);

    const exam = (await examStaff.get<Exam>(`/exams/${examId}`)).data;
    expect(exam).toMatchObject({
      name: examName,
      status: "draft",
      academic_session_id: scaffold.sessionId,
      academic_session_name: scaffold.sessionName,
      term_name: null,
      // No scale named: the exam takes the tenant default the seed made complete.
      grading_scale_name: E2E_GRADING_SCALE_NAME,
      subject_count: 1,
    });

    // `/exams` pages by number (api-architecture.md §2.4), not by cursor.
    const listed = await examStaff.get<Exam[]>("/exams", { query: { search: examName } });
    expect(listed.data.map((row) => row.id)).toEqual([examId]);
    const pagination = listed.meta?.pagination;
    // Page-number meta: only a counted page carries `total_pages`.
    expect(pagination).toHaveProperty("total_pages");
    expect(pagination).toMatchObject({ page: 1, total_count: 1 });

    const subjects = await examStaff.get<ExamSubject[]>("/exam-subjects", {
      query: { exam_id: examId },
    });
    expect(subjects.data).toEqual([
      expect.objectContaining({
        id: examSubjectId,
        exam_name: examName,
        class_name: scaffold.className,
        subject_name: scaffold.subjectName,
        max_marks: EXAM_SUBJECT_MAX_MARKS,
        pass_marks: EXAM_SUBJECT_PASS_MARKS,
      }),
    ]);

    // One configuration per (exam, class, subject): a field 422 the form can place, not the
    // bare 409 an IntegrityError would be.
    const duplicate = await refusal(
      examStaff.post("/exam-subjects", {
        exam_id: examId,
        class_id: scaffold.classId,
        subject_id: scaffold.subjectId,
        max_marks: EXAM_SUBJECT_MAX_MARKS,
        pass_marks: EXAM_SUBJECT_PASS_MARKS,
      }),
    );
    expect(duplicate.status).toBe(422);
    expect(duplicate.details.map((detail) => detail.field)).toContain("subject_id");

    const deleted = await examStaff.delete(`/exams/${examId}`);
    expect(deleted.status).toBe(204);
    expect((await refusal(examStaff.get(`/exams/${examId}`))).status).toBe(404);
  });

  test("an assigned teacher reads the default scale and its bands, unpaginated", async () => {
    const teacher = await teacherSession();

    // Reference data: an `assigned` teacher with no allocation still reads every scale.
    const scales = await teacher.get<GradingScale[]>("/grading-scales", {
      query: { search: E2E_GRADING_SCALE_NAME },
    });
    const scale = scales.data.find((row) => row.name === E2E_GRADING_SCALE_NAME);
    expect(scale).toMatchObject({ is_default: true });
    const pagination = scales.meta?.pagination;
    // Page-number meta: only a counted page carries `total_pages`.
    expect(pagination).toHaveProperty("total_pages");
    if (!scale) throw new Error("expected the seeded default scale");

    const bands = await teacher.get<GradeBand[]>(`/grading-scales/${scale.id}/grade-bands`);
    expect(bands.data.map((band) => band.label)).toEqual(SEEDED_BAND_LABELS);
    expect(bands.meta?.pagination).toBeUndefined();
  });

  test("an assigned teacher sees an exam once allocated to it, and no other", async ({
    liveApiClient,
  }) => {
    const [taught, untaught] = await Promise.all([
      seedExamScaffold(liveApiClient),
      seedExamScaffold(liveApiClient),
    ]);
    const examStaff = await examStaffSession();
    const taughtExam = await createExamWithSubject(examStaff, taught);
    const untaughtExam = await createExamWithSubject(examStaff, untaught);
    const teacher = await teacherSession();

    // Before the allocation the exam is out of scope: a 404, as a row the viewer may not see is.
    expect((await refusal(teacher.get(`/exams/${taughtExam.examId}`))).status).toBe(404);

    await allocateTeacher(liveApiClient, taught, await teacherLoginStaffId(liveApiClient));

    expect(await listedExamIds(teacher, taughtExam.examName)).toEqual([taughtExam.examId]);
    expect((await teacher.get<Exam>(`/exams/${taughtExam.examId}`)).data.name).toBe(
      taughtExam.examName,
    );
    const subjects = await teacher.get<ExamSubject[]>("/exam-subjects", {
      query: { exam_id: taughtExam.examId },
    });
    expect(subjects.data.map((row) => row.id)).toEqual([taughtExam.examSubjectId]);

    expect(await listedExamIds(teacher, untaughtExam.examName)).toEqual([]);
    expect((await refusal(teacher.get(`/exams/${untaughtExam.examId}`))).status).toBe(404);
  });
});
