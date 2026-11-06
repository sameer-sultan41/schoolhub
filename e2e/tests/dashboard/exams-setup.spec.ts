import { expect, test } from "@/fixtures";
import {
  buildRole,
  buildUser,
  EXAMS_AUTHOR_PERMISSIONS,
  EXAMS_TEACHER_PERMISSIONS,
  GRADING_SCALE_AUTHOR_PERMISSIONS,
  ORG_IDS,
  SCHOOL_ADMIN_PERMISSIONS,
} from "@/data/factories";
import { isApiCall } from "@/lib/request-matchers";
import {
  academicsCurriculumModule,
  buildAcademicSession,
  buildCurriculum,
  buildExam,
  buildExamSubject,
  buildGradeBand,
  buildGradingScale,
  buildSchoolClass,
  buildSubject,
  type Exam,
  type ExamSubject,
  examsSetupModule,
  type GradingScale,
  type MockApi,
  schoolOrganizationModule,
} from "@/mocks";

/**
 * Examinations setup (PR A) against a stubbed API: the Examinations sidebar group, the exams
 * list, an exam's page with its Subjects tab, and the grading scales list. The dialogs send the
 * right request and the screens reflect the response; the toolbar and rows gate on the viewer's
 * keys. The stub mirrors the server's refusals the screens surface (L5): a delete past `draft`
 * and a write past `scheduled` are 409s, a second (exam, class, subject) a 422 under
 * `subject_id`. Whether the server enforces them, and the teacher's `assigned` scope, are the
 * live lane's (`tests/live/api/exams-setup.spec.ts`).
 */

const session = buildAcademicSession({ id: ORG_IDS.currentSession, name: "2026-27" });
const grade1 = buildSchoolClass({ id: ORG_IDS.grade1, name: "Grade 1" });
const maths = buildSubject({ name: "Mathematics" });

const examAuthor = buildUser({
  permissions: [...SCHOOL_ADMIN_PERMISSIONS, ...EXAMS_AUTHOR_PERMISSIONS],
});
// Only what a real `teacher` holds for these screens: the exam keys, plus the session read the
// exams list's session filter makes (`school.academic-session.view`, held by all staff). No
// admin keys, so a control that leaks to a non-author is not hidden behind a wider set.
const teacher = buildUser({
  roles: [buildRole({ slug: "teacher", name: "Teacher" })],
  permissions: [...EXAMS_TEACHER_PERMISSIONS, "school.academic-session.view"],
});

const EXAMS_PATH = /\/exams$/;
const EXAM_SUBJECTS_PATH = /\/exam-subjects$/;
const SET_DEFAULT_PATH = /\/grading-scales\/[^/]+:set-default$/;

function defaultScale(): GradingScale {
  return buildGradingScale({ name: "Percentage", is_default: true });
}

/** A draft exam in the current session, built per test: a test mutates its `status`. */
function draftExam(overrides: Partial<Exam> = {}): Exam {
  return buildExam({
    name: "Midterm 2026",
    academic_session_id: session.id,
    academic_session_name: session.name,
    ...overrides,
  });
}

function mathsIn(exam: Exam): ExamSubject {
  return buildExamSubject({
    exam_id: exam.id,
    exam_name: exam.name,
    class_id: grade1.id,
    class_name: grade1.name,
    subject_id: maths.id,
    subject_name: maths.name,
  });
}

function stubExamsApi(
  mockApi: MockApi,
  setup: { exams?: Exam[]; examSubjects?: ExamSubject[]; gradingScales?: GradingScale[] } = {},
) {
  mockApi.use(
    schoolOrganizationModule({
      academicSessions: [session],
      classes: [grade1],
      subjects: [maths],
    }),
    academicsCurriculumModule({
      rows: [
        buildCurriculum({
          academic_session_id: session.id,
          class_id: grade1.id,
          class_name: grade1.name,
          subject_id: maths.id,
          subject_name: maths.name,
        }),
      ],
      sessions: [session],
      classes: [grade1],
      subjects: [maths],
    }),
    examsSetupModule({
      exams: setup.exams ?? [],
      examSubjects: setup.examSubjects ?? [],
      gradingScales: setup.gradingScales ?? [defaultScale()],
      sessions: [session],
      classes: [grade1],
      subjects: [maths],
    }),
  );
}

test.describe("examinations sidebar group", () => {
  test.use({
    authUser: buildUser({
      permissions: [
        ...SCHOOL_ADMIN_PERMISSIONS,
        ...EXAMS_AUTHOR_PERMISSIONS,
        ...GRADING_SCALE_AUTHOR_PERMISSIONS,
      ],
    }),
  });

  test("lists Exams and Grading scales under Examinations", async ({
    page,
    mockApi,
    dashboardPage,
    gradingScalesPage,
    signedIn: _signedIn,
  }) => {
    stubExamsApi(mockApi);
    await dashboardPage.goto();

    await dashboardPage.navGroup("Examinations").click();
    await expect(dashboardPage.navLink("Exams")).toBeVisible();
    await dashboardPage.navLink("Grading scales").click();

    await expect(page).toHaveURL(/\/exams\/grading-scales$/);
    await expect(gradingScalesPage.heading).toHaveText("Grading scales");
    await expect(dashboardPage.sectionTab("Exams", "Examinations")).toBeVisible();
  });
});

test.describe("an exam author", () => {
  test.use({ authUser: examAuthor });

  test("creates an exam, opens it, and adds a subject", async ({
    page,
    mockApi,
    examsPage,
    examPage,
    signedIn: _signedIn,
  }) => {
    stubExamsApi(mockApi);
    await examsPage.goto();
    await expect(examsPage.heading).toHaveText("Exams");

    await examsPage.createButton.click();
    // The session defaults to the current one; the scale is left to the school default.
    await expect(examsPage.formSelect("Academic session")).toContainText("2026-27");
    await examsPage.field("Name").fill("Final 2026");

    const createExam = page.waitForRequest((r) => isApiCall(r, "POST", EXAMS_PATH));
    await examsPage.saveButton.click();

    expect((await createExam).postDataJSON()).toEqual({
      name: "Final 2026",
      academic_session_id: session.id,
      term_id: null,
      exam_type: "midterm",
      weightage_percent: "100",
      starts_on: null,
      ends_on: null,
      description: null,
    });
    await expect(examsPage.formDialog).toBeHidden();
    await expect(examsPage.row("Final 2026")).toContainText("Draft");

    await examsPage.examLink("Final 2026").click();
    await expect(page).toHaveURL(/\/exams\/[0-9a-f-]{36}$/);
    const examId = new URL(page.url()).pathname.split("/").pop();
    await expect(examPage.heading).toHaveText("Final 2026");
    await expect(examPage.tab("Subjects")).toHaveAttribute("aria-selected", "true");

    await examPage.addSubjectButton.click();
    await examPage.subjectSelect("Class").click();
    await examPage.option("Grade 1").click();
    await examPage.subjectSelect("Subject").click();
    await examPage.option("Mathematics").click();
    await examPage.subjectField("Maximum marks").fill("100");
    await examPage.subjectField("Pass marks").fill("40");

    const createSubject = page.waitForRequest((r) => isApiCall(r, "POST", EXAM_SUBJECTS_PATH));
    await examPage.saveSubjectButton.click();

    expect((await createSubject).postDataJSON()).toEqual({
      exam_id: examId,
      class_id: grade1.id,
      subject_id: maths.id,
      max_marks: "100",
      pass_marks: "40",
      has_practical: false,
      practical_max_marks: null,
      practical_pass_marks: null,
      subject_weightage_percent: "100",
      marks_entry_opens_at: null,
      marks_entry_closes_at: null,
    });
    await expect(examPage.subjectDialog).toBeHidden();
    await expect(examPage.classHeading("Grade 1")).toBeVisible();
    await expect(examPage.subjectRow("Mathematics")).toContainText("40");
  });

  test("sees a duplicate subject refused under Subject, and the dialog stays open", async ({
    mockApi,
    examPage,
    signedIn: _signedIn,
  }) => {
    const exam = draftExam();
    stubExamsApi(mockApi, { exams: [exam], examSubjects: [mathsIn(exam)] });
    await examPage.gotoExam(exam.id);
    await expect(examPage.subjectRow("Mathematics")).toBeVisible();

    await examPage.addSubjectButton.click();
    await examPage.subjectSelect("Class").click();
    await examPage.option("Grade 1").click();
    await examPage.subjectSelect("Subject").click();
    await examPage.option("Mathematics").click();
    await examPage.subjectField("Maximum marks").fill("50");
    await examPage.subjectField("Pass marks").fill("20");
    await examPage.saveSubjectButton.click();

    await expect(examPage.subjectDialog).toContainText(
      "This subject is already on this exam for this class.",
    );
    await expect(examPage.subjectSelect("Subject")).toHaveAttribute("aria-invalid", "true");
  });

  test("sees the server's words when the exam moved past draft before a delete", async ({
    mockApi,
    examPage,
    signedIn: _signedIn,
  }) => {
    const exam = draftExam();
    stubExamsApi(mockApi, { exams: [exam] });
    await examPage.gotoExam(exam.id);
    await expect(examPage.deleteButton).toBeVisible();

    // Scheduled on the server while this page still shows a draft.
    exam.status = "scheduled";
    await examPage.deleteButton.click();
    await examPage.confirmDelete.click();

    await expect(examPage.deleteDialog).toContainText("Only a draft exam can be deleted.");
  });

  test("sees the frozen refusal when the exam moved past scheduled before a save", async ({
    mockApi,
    examPage,
    signedIn: _signedIn,
  }) => {
    const exam = draftExam();
    stubExamsApi(mockApi, { exams: [exam] });
    await examPage.gotoExam(exam.id);

    await examPage.addSubjectButton.click();
    await examPage.subjectSelect("Class").click();
    await examPage.option("Grade 1").click();
    await examPage.subjectSelect("Subject").click();
    await examPage.option("Mathematics").click();
    await examPage.subjectField("Maximum marks").fill("100");
    await examPage.subjectField("Pass marks").fill("40");

    exam.status = "marks_entry";
    await examPage.saveSubjectButton.click();

    await expect(examPage.subjectDialog).toContainText("its configuration is frozen");
  });

  test("deletes a draft exam from its page and returns to the list", async ({
    page,
    mockApi,
    examPage,
    examsPage,
    signedIn: _signedIn,
  }) => {
    const exam = draftExam();
    stubExamsApi(mockApi, { exams: [exam] });
    await examPage.gotoExam(exam.id);

    await examPage.deleteButton.click();
    await examPage.confirmDelete.click();

    await expect(page).toHaveURL(/\/exams$/);
    await expect(examsPage.row("Midterm 2026")).toHaveCount(0);
  });
});

test.describe("a teacher", () => {
  test.use({ authUser: teacher });

  test("sees the exams list and an exam's subjects read-only", async ({
    mockApi,
    examsPage,
    examPage,
    signedIn: _signedIn,
  }) => {
    const exam = draftExam({ subject_count: 1 });
    stubExamsApi(mockApi, { exams: [exam], examSubjects: [mathsIn(exam)] });
    await examsPage.goto();

    await expect(examsPage.row("Midterm 2026")).toBeVisible();
    await expect(examsPage.createButton).toHaveCount(0);
    await expect(examsPage.rowAction("Midterm 2026", "Edit")).toHaveCount(0);
    await expect(examsPage.rowAction("Midterm 2026", "Delete")).toHaveCount(0);

    await examsPage.examLink("Midterm 2026").click();
    await expect(examPage.subjectRow("Mathematics")).toBeVisible();
    await expect(examPage.addSubjectButton).toHaveCount(0);
    await expect(examPage.subjectAction("Mathematics", "Grade 1", "Edit")).toHaveCount(0);
    await expect(examPage.editButton).toHaveCount(0);
    await expect(examPage.deleteButton).toHaveCount(0);
  });
});

test.describe("grading scales", () => {
  test.use({
    authUser: buildUser({
      permissions: [...SCHOOL_ADMIN_PERMISSIONS, ...GRADING_SCALE_AUTHOR_PERMISSIONS],
    }),
  });

  test("moves the default and opens a scale's bands", async ({
    page,
    mockApi,
    gradingScalesPage,
    signedIn: _signedIn,
  }) => {
    const letters = buildGradingScale({ name: "Letters", scale_type: "letter" });
    letters.bands = [
      buildGradeBand({ grading_scale_id: letters.id, label: "Pass", min_percent: "40.00" }),
      buildGradeBand({
        grading_scale_id: letters.id,
        label: "Fail",
        min_percent: "0.00",
        max_percent: "39.99",
        is_passing: false,
        sort_order: 1,
      }),
    ];
    stubExamsApi(mockApi, { gradingScales: [defaultScale(), letters] });
    await gradingScalesPage.goto();

    await expect(gradingScalesPage.row("Percentage")).toContainText("Default");
    await expect(gradingScalesPage.makeDefaultButton("Percentage")).toHaveCount(0);

    const setDefault = page.waitForRequest((r) => isApiCall(r, "POST", SET_DEFAULT_PATH));
    await gradingScalesPage.makeDefaultButton("Letters").click();
    await setDefault;

    await expect(gradingScalesPage.row("Letters")).toContainText("Default");
    await expect(gradingScalesPage.row("Percentage")).not.toContainText("Default");

    await gradingScalesPage.bandsButton("Letters").click();
    await expect(gradingScalesPage.bandsDialog("Letters")).toContainText("Fail");
  });
});
