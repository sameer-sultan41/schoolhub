import { expect, test } from "@/fixtures";
import {
  buildRole,
  buildUser,
  EXAMS_AUTHOR_PERMISSIONS,
  EXAMS_TEACHER_PERMISSIONS,
  ORG_IDS,
  uuid,
} from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  buildAcademicSession,
  buildExam,
  buildExamSubject,
  buildGradingScale,
  buildMarksRow,
  buildSchoolClass,
  buildSection,
  type Exam,
  type ExamStatus,
  examsMarksModule,
  examsSetupModule,
  type MarksRollStudent,
  type MarksRow,
  type MockApi,
  schoolOrganizationModule,
} from "@/mocks";

/**
 * An exam's Marks tab (PR C) against a stubbed API: a teacher opens their section's grid from
 * progress, enters marks with one absentee and submits; an out-of-range mark is refused inline
 * by the server, with every entry kept; and the exam author locks the subject, after which the
 * grid is read-only with the server's reason. The stub mirrors the server's rules the tab
 * surfaces (L5): the section gate, whole-grid refusal in `error.meta.rows`, absent/exempt
 * exclusivity, and the lock. Whether the server enforces them is the live lane's
 * (`tests/live/api/exams-marks.spec.ts`).
 */

const session = buildAcademicSession({ id: ORG_IDS.currentSession, name: "2026-27" });
const grade1 = buildSchoolClass({ id: ORG_IDS.grade1, name: "Grade 1" });
const sectionA = buildSection({ id: ORG_IDS.sectionA, name: "A", class_id: grade1.id });
const sectionB = buildSection({ id: ORG_IDS.sectionB, name: "B", class_id: grade1.id });

const ali = rollStudent("Ali Raza", "ADM-001", "1", sectionA.id);
const sara = rollStudent("Sara Khan", "ADM-002", "2", sectionA.id);
const omar = rollStudent("Omar Malik", "ADM-003", "3", sectionA.id);
const zainab = rollStudent("Zainab Ali", "ADM-004", "1", sectionB.id);

const SECTION_A = "Grade 1 – A";
const SECTION_B = "Grade 1 – B";
const GRID_A = "Mathematics · Grade 1 – A";

// A `teacher`'s keys for this tab (examinations.md §4): read and enter marks, no lock, no import.
const teacher = buildUser({
  roles: [buildRole({ slug: "teacher", name: "Teacher" })],
  permissions: [
    ...EXAMS_TEACHER_PERMISSIONS,
    "school.academic-session.view",
    "exams.marks.view",
    "exams.marks.create",
    "exams.marks.update",
  ],
});
// An `exam_staff`'s: the exam author's keys plus every marks key the role holds.
const examStaff = buildUser({
  roles: [buildRole({ slug: "exam_staff", name: "Exam staff" })],
  permissions: [
    ...EXAMS_AUTHOR_PERMISSIONS,
    "exams.marks.view",
    "exams.marks.create",
    "exams.marks.update",
    "exams.marks.import",
    "exams.marks.lock",
  ],
});

const BULK_ENTRY_PATH = /\/marks:bulk-entry$/;
const LOCK_PATH = /\/exam-subjects\/[^/]+:lock-marks$/;

function rollStudent(
  studentName: string,
  admissionNumber: string,
  rollNumber: string,
  sectionId: string,
): MarksRollStudent {
  return { studentId: uuid(), studentName, admissionNumber, rollNumber, sectionId };
}

interface MarksApiSetup {
  status: ExamStatus;
  /** The teacher's allocation: section A only. Omit for `all` scope. */
  teacherScope?: boolean;
  marks?: (examSubjectId: string) => MarksRow[];
}

/** An exam with Mathematics for Grade 1, sat by A (three students) and B (one). */
function stubMarksApi(mockApi: MockApi, setup: MarksApiSetup): { exam: Exam; mathsId: string } {
  const exam = buildExam({
    name: "Midterm 2026",
    academic_session_id: session.id,
    academic_session_name: session.name,
    status: setup.status,
    subject_count: 1,
  });
  const maths = buildExamSubject({
    exam_id: exam.id,
    class_id: grade1.id,
    class_name: grade1.name,
    subject_name: "Mathematics",
  });
  const exams = [exam];
  const examSubjects = [maths];

  mockApi.use(
    schoolOrganizationModule({
      academicSessions: [session],
      classes: [grade1],
      sections: [sectionA, sectionB],
    }),
    examsSetupModule({
      exams,
      examSubjects,
      gradingScales: [buildGradingScale({ is_default: true })],
      sessions: [session],
      classes: [grade1],
    }),
    examsMarksModule({
      exams,
      examSubjects,
      sections: [
        { id: sectionA.id, name: sectionA.name, classId: grade1.id },
        { id: sectionB.id, name: sectionB.name, classId: grade1.id },
      ],
      roll: [ali, sara, omar, zainab],
      marks: setup.marks?.(maths.id) ?? [],
      ...(setup.teacherScope
        ? { enterable: [{ examSubjectId: maths.id, sectionId: sectionA.id }] }
        : {}),
    }),
  );
  return { exam, mathsId: maths.id };
}

test.describe("a teacher entering marks", () => {
  test.use({ authUser: teacher });

  test("opens their section from progress, enters marks with an absentee, and submits", async ({
    page,
    mockApi,
    examMarksPage,
    signedIn: _signedIn,
  }) => {
    const { exam, mathsId } = stubMarksApi(mockApi, { status: "scheduled", teacherScope: true });
    await examMarksPage.gotoMarks(exam.id);

    // Only the section they teach, and no Lock (the teacher lacks `exams.marks.lock`).
    await expect(examMarksPage.progressRows).toHaveCount(1);
    const progress = examMarksPage.progressRow("Mathematics", SECTION_A);
    await expect(progress).toContainText("0 of 3");
    await expect(progress).toContainText("Not started");
    await expect(examMarksPage.lockButton("Mathematics", SECTION_A, "Grade 1")).toHaveCount(0);

    await examMarksPage.enterButton("Mathematics", SECTION_A).click();
    await expect(page).toHaveURL(new RegExp(`subject=${mathsId}`));
    await expect(page).toHaveURL(new RegExp(`section=${sectionA.id}`));
    await expect(examMarksPage.grid(GRID_A)).toBeVisible();

    // Submit waits until every student has a mark, or is marked absent or exempt.
    await expect(examMarksPage.submitButton).toBeDisabled();
    await examMarksPage.theoryInput(ali.studentName).fill("78");
    await examMarksPage.absentCheckbox(sara.studentName).click();
    await expect(examMarksPage.theoryInput(sara.studentName)).toBeDisabled();
    await examMarksPage.theoryInput(omar.studentName).fill("64.5");
    await expect(examMarksPage.submitButton).toBeEnabled();

    const submit = page.waitForRequest((r) => isApiCall(r, "POST", BULK_ENTRY_PATH));
    await examMarksPage.submitButton.click();
    const request = await submit;
    expect(request.headers()["idempotency-key"]).toBeTruthy();
    expect(request.postDataJSON()).toMatchObject({
      exam_subject_id: mathsId,
      section_id: sectionA.id,
      entries: [
        { student_id: ali.studentId, theory_marks: "78", is_absent: false, status: "submitted" },
        { student_id: sara.studentId, theory_marks: null, is_absent: true, status: "submitted" },
        { student_id: omar.studentId, theory_marks: "64.5", is_absent: false, status: "submitted" },
      ],
    });
    await expect(page.getByText("Marks submitted: 3 entered, 0 updated.")).toBeVisible();

    await examMarksPage.backButton.click();
    await expect(progress).toContainText("Submitted");
    await expect(progress).not.toContainText("0 of 3");
  });

  test("sees an out-of-range mark refused on its row, with every entry kept", async ({
    page,
    mockApi,
    examMarksPage,
    signedIn: _signedIn,
  }) => {
    const { exam } = stubMarksApi(mockApi, { status: "marks_entry", teacherScope: true });
    await examMarksPage.gotoMarks(exam.id);
    await examMarksPage.enterButton("Mathematics", SECTION_A).click();

    // Above the maximum: hinted as typed, but sent, so the server's own refusal names it.
    await examMarksPage.theoryInput(ali.studentName).fill("105");
    await expect(examMarksPage.gridRow(ali.studentName)).toContainText("Above the maximum of 100.");
    await examMarksPage.theoryInput(sara.studentName).fill("50");
    await examMarksPage.theoryInput(omar.studentName).fill("60");
    await examMarksPage.submitButton.click();

    await expect(
      examMarksPage.notice("1 of 3 rows were rejected; nothing was saved."),
    ).toBeVisible();
    await expect(examMarksPage.gridRow(ali.studentName)).toContainText(
      "105.00 is above this subject's maximum of 100.00.",
    );
    await expect(examMarksPage.theoryInput(ali.studentName)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(examMarksPage.theoryInput(sara.studentName)).toHaveValue("50");
    await expect(examMarksPage.theoryInput(omar.studentName)).toHaveValue("60");

    // Corrected, the whole grid goes in: nothing from the refused submit had been saved.
    await examMarksPage.theoryInput(ali.studentName).fill("95");
    await examMarksPage.submitButton.click();
    await expect(page.getByText("Marks submitted: 3 entered, 0 updated.")).toBeVisible();
  });
});

test.describe("the exam author", () => {
  test.use({ authUser: examStaff });

  test("locks a subject, and its grid turns read-only with the server's reason", async ({
    page,
    mockApi,
    examMarksPage,
    signedIn: _signedIn,
  }) => {
    const { exam } = stubMarksApi(mockApi, {
      status: "marks_entry",
      marks: (examSubjectId) => [
        buildMarksRow({
          exam_subject_id: examSubjectId,
          student_id: ali.studentId,
          theory_marks: "78.00",
          status: "submitted",
        }),
        buildMarksRow({
          exam_subject_id: examSubjectId,
          student_id: sara.studentId,
          is_absent: true,
          status: "submitted",
        }),
        buildMarksRow({
          exam_subject_id: examSubjectId,
          student_id: omar.studentId,
          theory_marks: "64.50",
          status: "submitted",
        }),
      ],
    });
    await examMarksPage.gotoMarks(exam.id);

    // Every section at `all` scope: A finished, B not started.
    await expect(examMarksPage.progressRows).toHaveCount(2);
    await expect(examMarksPage.progressRow("Mathematics", SECTION_A)).toContainText("Submitted");
    await expect(examMarksPage.progressRow("Mathematics", SECTION_B)).toContainText("Not started");

    const lock = page.waitForRequest((r) => isApiCall(r, "POST", LOCK_PATH));
    await examMarksPage.lockButton("Mathematics", SECTION_A, "Grade 1").click();
    await lock;
    await expect(page.getByText("Mathematics marks locked.")).toBeVisible();

    // The lock covers the whole exam-subject: both sections, and Unlock in place of Lock.
    await expect(examMarksPage.progressRow("Mathematics", SECTION_A)).toContainText("Locked");
    await expect(examMarksPage.progressRow("Mathematics", SECTION_B)).toContainText("Locked");
    await expect(examMarksPage.unlockButton("Mathematics", SECTION_A, "Grade 1")).toBeVisible();
    await expect(examMarksPage.unlockHint).toBeVisible();

    await examMarksPage.enterButton("Mathematics", SECTION_A).click();
    await expect(examMarksPage.grid(GRID_A)).toBeVisible();
    await expect(
      examMarksPage.notice(
        "Marks for this subject are locked. They can only be changed after an unlock, " +
          "which is audited.",
      ),
    ).toBeVisible();
    await expect(examMarksPage.gridRow(ali.studentName)).toContainText("78");
    await expect(examMarksPage.gridRow(sara.studentName)).toContainText("Absent");
    await expect(examMarksPage.theoryInputs).toHaveCount(0);
    await expect(examMarksPage.submitButton).toHaveCount(0);
    await expect(examMarksPage.saveDraftButton).toHaveCount(0);
  });
});
