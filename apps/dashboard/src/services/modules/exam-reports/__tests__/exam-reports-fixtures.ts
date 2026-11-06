import type { ExamReportRowOf } from "../exam-reports-type";

/**
 * Report rows in the exact shapes `GET /reports/exam-summary` sends (the typed row serializers,
 * `apps/api/apps/examinations/report_serializers.py`): every row carries its `kind`, decimals are
 * JSON numbers, and a band's fields are null for the ungraded.
 */

const STUDENT_ID = "22222222-bbbb-4ccc-8ddd-000000000001";
const RESULT_ID = "33333333-bbbb-4ccc-8ddd-000000000001";
const SECTION_ID = "44444444-bbbb-4ccc-8ddd-000000000001";
const EXAM_SUBJECT_ID = "55555555-bbbb-4ccc-8ddd-000000000001";
const BAND_ID = "66666666-bbbb-4ccc-8ddd-000000000001";
const BANK_ID = "77777777-bbbb-4ccc-8ddd-000000000001";
export const JOB_ID = "88888888-bbbb-4ccc-8ddd-000000000001";
export const FILE_ID = "99999999-bbbb-4ccc-8ddd-000000000001";

export function resultRegisterRow(
  overrides: Partial<ExamReportRowOf<"result-register">> = {},
): ExamReportRowOf<"result-register"> {
  return {
    kind: "result-register",
    id: RESULT_ID,
    student_id: STUDENT_ID,
    first_name: "Ayesha",
    last_name: "Khan",
    admission_number: "ADM-001",
    section_name: "7-A",
    percentage: 78.5,
    total_obtained_marks: 314,
    total_max_marks: 400,
    grade: "B",
    gpa: 3.2,
    rank_in_section: 2,
    rank_in_class: 5,
    outcome: "pass",
    status: "published",
    ...overrides,
  };
}

export function passFailRow(
  overrides: Partial<ExamReportRowOf<"pass-fail-analysis">> = {},
): ExamReportRowOf<"pass-fail-analysis"> {
  return {
    kind: "pass-fail-analysis",
    section_id: SECTION_ID,
    section_name: "7-A",
    students: 30,
    sat: 28,
    passed: 25,
    failed: 3,
    absent: 2,
    withheld: 0,
    average_percentage: 71.25,
    highest_percentage: 96,
    lowest_percentage: 31.5,
    pass_rate: 89.3,
    ...overrides,
  };
}

export function subjectPerformanceRow(
  overrides: Partial<ExamReportRowOf<"subject-performance">> = {},
): ExamReportRowOf<"subject-performance"> {
  return {
    kind: "subject-performance",
    exam_subject_id: EXAM_SUBJECT_ID,
    subject_name: "Mathematics",
    class_name: "Grade 7",
    max_marks: 100,
    pass_marks: 33,
    students: 28,
    average_marks: 64.5,
    highest_marks: 98,
    lowest_marks: null,
    passed: 24,
    pass_rate: 85.7,
    ...overrides,
  };
}

export function marksEntryStatusRow(
  overrides: Partial<ExamReportRowOf<"marks-entry-status">> = {},
): ExamReportRowOf<"marks-entry-status"> {
  return {
    kind: "marks-entry-status",
    exam_subject_id: EXAM_SUBJECT_ID,
    subject_name: "Science",
    class_name: "Grade 7",
    locked_at: null,
    entered: 20,
    draft: 5,
    submitted: 15,
    locked: 0,
    absent: 1,
    exempt: 2,
    ...overrides,
  };
}

export function gradeDistributionRow(
  overrides: Partial<ExamReportRowOf<"grade-distribution">> = {},
): ExamReportRowOf<"grade-distribution"> {
  return {
    kind: "grade-distribution",
    grade_band_id: BAND_ID,
    grade: "A",
    min_percent: 80,
    max_percent: 89.99,
    is_passing: true,
    students: 7,
    ...overrides,
  };
}

/** The ungraded row: results with no band, every band field null. */
export function ungradedRow(): ExamReportRowOf<"grade-distribution"> {
  return gradeDistributionRow({
    grade_band_id: null,
    grade: null,
    min_percent: null,
    max_percent: null,
    is_passing: null,
    students: 3,
  });
}

export function questionBankUsageRow(
  overrides: Partial<ExamReportRowOf<"question-bank-usage">> = {},
): ExamReportRowOf<"question-bank-usage"> {
  return {
    kind: "question-bank-usage",
    question_bank_id: BANK_ID,
    bank_name: "Algebra I",
    subject_name: "Mathematics",
    difficulty: "hard",
    questions: 12,
    approved: 10,
    total_uses: 4,
    average_uses: 1.5,
    ...overrides,
  };
}

/** The `202` body a too-large run, or any export, answers with (`ActionResponse.accepted`). */
export const ACCEPTED = { job_id: JOB_ID, status: "queued" } as const;
