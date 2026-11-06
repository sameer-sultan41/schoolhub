import { buildRole, buildUser, EXAMS_AUTHOR_PERMISSIONS, ORG_IDS, uuid } from "@/data/factories";
import { E2E_PRINCIPAL_PERMISSIONS } from "@/lib/seed-constants";
import {
  buildAcademicSession,
  buildExam,
  buildExamSubject,
  buildGradingScale,
  buildResult,
  buildSchoolClass,
  buildSection,
  buildSitting,
  type ComputedResult,
  type Exam,
  type ExamResult,
  type ExamsResultsState,
  type ExamStatus,
  examsReportCardsModule,
  examsResultsModule,
  examsResultsState,
  examsScheduleModule,
  examsSetupModule,
  type MockApi,
  schoolOrganizationModule,
} from "@/mocks";

/**
 * The world the results specs share (`exams-results.spec.ts`, the Results tab, and
 * `exams-report-cards.spec.ts`, the Report cards tab and the result register): one exam with
 * Mathematics for Grade 1, sat by section A, the three viewers, and the stub that puts them
 * behind a `MockApi`.
 *
 * **Route ownership** (the router has no fallthrough and a later stub wins): `stubResultsApi`
 * registers `examsScheduleModule` first, for the sittings the section filters read, then
 * `examsResultsModule`, which therefore owns `POST /exams/:examAction` and `GET /jobs/:jobId`
 * (both modules register them), then `examsReportCardsModule`, which registers neither and adds
 * `:generate-report-cards` to the shared state the results module dispatches. One owner per route.
 */

const session = buildAcademicSession({ id: ORG_IDS.currentSession, name: "2026-27" });
const grade1 = buildSchoolClass({ id: ORG_IDS.grade1, name: "Grade 1" });
const sectionA = buildSection({ id: ORG_IDS.sectionA, name: "A", class_id: grade1.id });

export const ALI = "Ali Raza";
export const SARA = "Sara Khan";
export const OMAR = "Omar Malik";
export const EXAM_STAFF_NAME = "Bilal Ahmed";
export const EXAM_NAME = "Midterm 2026";

/** What processing computes: two passes and an absentee, ranked by percentage. */
function computedFor(): ComputedResult[] {
  const base = {
    section_id: sectionA.id,
    section_name: sectionA.name,
    total_max_marks: "100.00",
    gpa: null,
    rank_in_class: null,
  };
  return [
    {
      ...base,
      student_id: uuid(),
      student_name: ALI,
      admission_number: "ADM-001",
      total_obtained_marks: "78.00",
      percentage: "78.00",
      grade: "A",
      rank_in_section: 1,
      outcome: "pass",
    },
    {
      ...base,
      student_id: uuid(),
      student_name: OMAR,
      admission_number: "ADM-003",
      total_obtained_marks: "64.50",
      percentage: "64.50",
      grade: "B",
      rank_in_section: 2,
      outcome: "pass",
    },
    {
      ...base,
      student_id: uuid(),
      student_name: SARA,
      admission_number: "ADM-002",
      total_obtained_marks: "0.00",
      percentage: "0.00",
      grade: "F",
      rank_in_section: null,
      outcome: "absent",
    },
  ];
}

// `exam_staff`'s keys for these tabs (examinations.md §4): process, never approve; generate cards.
export const examStaff = buildUser({
  full_name: EXAM_STAFF_NAME,
  roles: [buildRole({ slug: "exam_staff", name: "Exam staff" })],
  permissions: [
    ...EXAMS_AUTHOR_PERMISSIONS,
    "exams.schedule.view",
    "exams.marks.view",
    "exams.result.view",
    "exams.result.create",
    "exams.report-card.view",
    "exams.report-card.create",
  ],
});
// The live approver's exact keys (`seed_e2e_data.py`'s `e2e-principal`): approve and publish
// results, publish cards; never process, and no export key (L5).
export const principal = buildUser({
  full_name: "Nadia Hussain",
  roles: [buildRole({ slug: "principal", name: "Principal" })],
  permissions: [...E2E_PRINCIPAL_PERMISSIONS],
});
// A `school_owner` holds every key, so both halves of §4's split meet in one person.
export const owner = buildUser({
  full_name: "Imran Qureshi",
  roles: [buildRole({ slug: "school_owner", name: "School owner" })],
  permissions: [
    "exams.exam.view",
    "exams.schedule.view",
    "exams.marks.view",
    "exams.result.view",
    "exams.result.create",
    "exams.result.approve",
    "exams.result.publish",
  ],
});

export interface ResultsApiSetup {
  status: ExamStatus;
  viewer: { id: string; full_name: string };
  /** The results already processed, given the computed rows. */
  results?: (exam: Exam, computed: ComputedResult[]) => ExamResult[];
  outstanding?: string[];
}

/** The stubbed exam, and the results state its modules share (for a spec that changes the
 * server's state behind the screen's back). */
export interface StubbedResults {
  exam: Exam;
  state: ExamsResultsState;
}

/** An exam with Mathematics for Grade 1, sat by section A (Ali, Omar, and Sara who was absent). */
export function stubResultsApi(mockApi: MockApi, setup: ResultsApiSetup): StubbedResults {
  const exam = buildExam({
    name: EXAM_NAME,
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
  const computed = computedFor();
  const state = examsResultsState({
    exams,
    computed,
    viewer: { id: setup.viewer.id, fullName: setup.viewer.full_name },
    results: setup.results?.(exam, computed) ?? [],
    ...(setup.outstanding ? { outstanding: setup.outstanding } : {}),
  });

  mockApi.use(
    schoolOrganizationModule({
      academicSessions: [session],
      classes: [grade1],
      sections: [sectionA],
    }),
    examsSetupModule({
      exams,
      examSubjects: [maths],
      gradingScales: [buildGradingScale({ is_default: true })],
      sessions: [session],
      classes: [grade1],
    }),
    // First: the results module after it owns `/exams/{id}:<action>` and `/jobs/{id}`.
    examsScheduleModule({
      exams,
      sittings: [
        buildSitting({
          exam_id: exam.id,
          exam_subject_id: maths.id,
          section_id: sectionA.id,
          section_name: sectionA.name,
        }),
      ],
    }),
    examsResultsModule(state),
    examsReportCardsModule(state),
  );
  return { exam, state };
}

/** The computed rows as results awaiting approval, processed by `processor`. */
export function pendingResults(
  exam: Exam,
  computed: ComputedResult[],
  processor: { id: string; full_name: string },
  overrides: (row: ComputedResult) => Partial<ExamResult> = () => ({}),
): ExamResult[] {
  return computed.map((row) =>
    buildResult({
      ...row,
      exam_id: exam.id,
      status: "pending_approval",
      processed_by: processor.id,
      processed_by_name: processor.full_name,
      ...overrides(row),
    }),
  );
}
