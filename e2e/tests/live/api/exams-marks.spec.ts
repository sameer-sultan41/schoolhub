import { ApiError, type ApiClient } from "@schoolhub/api-client";
import { expect, test } from "@/fixtures";
import {
  addEnrolledSection,
  allocateTeacher,
  createExamWithSubject,
  EXAM_SUBJECT_MAX_MARKS,
  EXAM_THEORY_MARK,
  examStaffSession,
  publishExamForMarks,
  seedExamScaffold,
  submitSectionMarks,
  teacherLoginStaffId,
  teacherSession,
} from "@/lib/live-exams";

/**
 * Live API lane — no browser. See campuses.spec.ts's header for the shared rationale.
 *
 * Examinations marks entry (PR C), on run-unique scaffolds (`@/lib/live-exams`): the seeded
 * `teacher` (`assigned` scope), allocated to one section of the exam's class, sees exactly that
 * section in progress, reads its roster in the grid and submits it; the sibling section of the
 * same exam-subject, and another scaffold's section, are 404s to them, and a write to the sibling
 * is a 422 on `section_id`. The seeded `exam_staff` (`all` scope) then sees entered = expected
 * for the teacher's section, locks the subject, and the teacher's re-submission is refused. The
 * worker's admin builds the scaffolds and the allocation.
 *
 * Endpoints covered: `GET /exams/{id}/marks-progress`, `GET /marks/grid`,
 * `POST /marks:bulk-entry`, `POST /exam-subjects/{id}:lock-marks`.
 */

interface ProgressRow {
  exam_subject_id: string;
  section_id: string;
  expected: number;
  entered: number;
  submitted: number;
  is_locked: boolean;
}

interface MarksRow {
  student_id: string;
  theory_marks: string | null;
  is_absent: boolean;
  status: string;
}

interface GridEntry {
  student_id: string;
  student_name: string;
  marks: MarksRow | null;
}

interface GridMeta {
  exam_subject: { max_marks: string };
  writable: boolean;
  unwritable_reason: string | null;
}

async function refusal(request: Promise<unknown>): Promise<ApiError> {
  const outcome = await request.catch((error: unknown) => error);
  expect(outcome).toBeInstanceOf(ApiError);
  return outcome as ApiError;
}

function progressOf(client: ApiClient, examId: string) {
  return client.get<ProgressRow[]>(`/exams/${examId}/marks-progress`);
}

function gridOf(client: ApiClient, examSubjectId: string, sectionId: string) {
  return client.get<GridEntry[]>("/marks/grid", {
    query: { exam_subject_id: examSubjectId, section_id: sectionId },
  });
}

test.describe("exam marks entry", () => {
  test("an assigned teacher enters their section; the exam staff locks it", async ({
    liveApiClient,
  }) => {
    const staff = await examStaffSession();
    const teacher = await teacherSession();
    const scaffold = await seedExamScaffold(liveApiClient);
    const sibling = await addEnrolledSection(liveApiClient, scaffold);
    const exam = await createExamWithSubject(staff, scaffold);
    await allocateTeacher(liveApiClient, scaffold, await teacherLoginStaffId(liveApiClient));
    await publishExamForMarks(staff, scaffold, exam);
    const roster = scaffold.studentIds;

    // Progress lists exactly the teacher's section; the exam staff sees both.
    const teacherProgress = (await progressOf(teacher, exam.examId)).data;
    expect(teacherProgress).toHaveLength(1);
    expect(teacherProgress[0]).toMatchObject({
      exam_subject_id: exam.examSubjectId,
      section_id: scaffold.sectionId,
      expected: roster.length,
      entered: 0,
      submitted: 0,
      is_locked: false,
    });
    const staffSections = (await progressOf(staff, exam.examId)).data.map((row) => row.section_id);
    expect(staffSections.sort()).toEqual([scaffold.sectionId, sibling.sectionId].sort());

    // The grid is the section's roster, nothing entered yet, writable.
    const grid = await gridOf(teacher, exam.examSubjectId, scaffold.sectionId);
    expect(grid.data.map((entry) => entry.student_id).sort()).toEqual([...roster].sort());
    for (const entry of grid.data) {
      expect(entry.student_name).toBeTruthy();
      expect(entry.marks).toBeNull();
    }
    const meta = grid.meta as unknown as GridMeta;
    expect(meta.writable).toBe(true);
    expect(meta.exam_subject.max_marks).toBe(EXAM_SUBJECT_MAX_MARKS);

    // The sibling section of the same exam-subject is not theirs: a 404 to read, a 422 to write.
    const siblingGrid = await refusal(gridOf(teacher, exam.examSubjectId, sibling.sectionId));
    expect(siblingGrid.status).toBe(404);
    const siblingWrite = await refusal(
      submitSectionMarks(teacher, exam.examSubjectId, sibling.sectionId, sibling.studentIds),
    );
    expect(siblingWrite.status).toBe(422);
    expect(siblingWrite.details.map((detail) => detail.field)).toEqual(["section_id"]);

    // Submit: every student, one absent. The first write moves the exam to `marks_entry`.
    const submitted = await submitSectionMarks(
      teacher,
      exam.examSubjectId,
      scaffold.sectionId,
      roster,
    );
    expect(submitted.data).toEqual({ entered: roster.length, updated: 0, rows: roster.length });
    const moved = await staff.get<{ status: string }>(`/exams/${exam.examId}`);
    expect(moved.data.status).toBe("marks_entry");

    const reread = await gridOf(teacher, exam.examSubjectId, scaffold.sectionId);
    const absentee = reread.data.find((entry) => entry.student_id === roster[0]);
    expect(absentee?.marks).toMatchObject({ is_absent: true, theory_marks: null });
    for (const entry of reread.data.filter((row) => row.student_id !== roster[0])) {
      expect(entry.marks).toMatchObject({ theory_marks: EXAM_THEORY_MARK, status: "submitted" });
    }

    // The exam staff sees the teacher's section complete, and the sibling untouched.
    const staffProgress = (await progressOf(staff, exam.examId)).data;
    expect(staffProgress.find((row) => row.section_id === scaffold.sectionId)).toMatchObject({
      expected: roster.length,
      entered: roster.length,
      submitted: roster.length,
    });
    expect(staffProgress.find((row) => row.section_id === sibling.sectionId)).toMatchObject({
      expected: sibling.studentIds.length,
      entered: 0,
    });

    const locked = await staff.post<{ locked_rows: number; already_locked: boolean }>(
      `/exam-subjects/${exam.examSubjectId}:lock-marks`,
    );
    expect(locked.data).toEqual({ locked_rows: roster.length, already_locked: false });

    // Locked: a re-submission is refused, and the grid says why.
    const resubmit = await refusal(
      submitSectionMarks(teacher, exam.examSubjectId, scaffold.sectionId, roster),
    );
    expect(resubmit.status).toBe(409);
    const closed = await gridOf(teacher, exam.examSubjectId, scaffold.sectionId);
    expect(closed.meta as unknown as GridMeta).toMatchObject({
      writable: false,
      unwritable_reason: "locked",
    });
    expect((await progressOf(teacher, exam.examId)).data[0]?.is_locked).toBe(true);
  });

  test("another scaffold's exam and section are 404s to an allocated teacher", async ({
    liveApiClient,
  }) => {
    const staff = await examStaffSession();
    const teacher = await teacherSession();
    const taught = await seedExamScaffold(liveApiClient);
    await allocateTeacher(liveApiClient, taught, await teacherLoginStaffId(liveApiClient));
    const other = await seedExamScaffold(liveApiClient);
    const otherExam = await createExamWithSubject(staff, other);

    // Visible to the exam staff, so a 404 to the teacher is their scope, not a missing row.
    expect((await progressOf(staff, otherExam.examId)).data).toHaveLength(1);
    expect((await gridOf(staff, otherExam.examSubjectId, other.sectionId)).data).toHaveLength(
      other.studentIds.length,
    );

    expect((await refusal(progressOf(teacher, otherExam.examId))).status).toBe(404);
    const grid = await refusal(gridOf(teacher, otherExam.examSubjectId, other.sectionId));
    expect(grid.status).toBe(404);
  });
});
