import type { ApiSchemas } from "@schoolhub/api-client";
import { uuid } from "@/data/factories";
import type { MockResponse } from "../envelope";
import type { MockRequest } from "../router";
import type { Exam, ExamStatus } from "./exams-setup";

/**
 * The state `examsResultsModule` (`exams-results.ts`) and `examsReportCardsModule`
 * (`exams-report-cards.ts`) share, and the wire types and wording both use. A spec builds it once
 * per test with `examsResultsState` and hands the same object to both modules.
 */

/** The generated schema marks server-set fields `readonly`; a stub is the server, so it writes
 * them (a status, a stamp, a file). */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** The generated wire shape: a contract change breaks these stubs at compile time. */
export type ExamResult = Writable<ApiSchemas["Result"]>;

/** When the stub's lifecycle actions happen: every stamp they write. */
export const RESULTS_ACTED_AT = "2026-09-02T00:00:00Z";

/** The figures a processing run computes for one student; the stub has no marks engine. */
export type ComputedResult = Pick<
  ExamResult,
  | "student_id"
  | "student_name"
  | "admission_number"
  | "section_id"
  | "section_name"
  | "total_max_marks"
  | "total_obtained_marks"
  | "percentage"
  | "grade"
  | "gpa"
  | "rank_in_section"
  | "rank_in_class"
  | "outcome"
>;

/** A signed-in user as the stub stamps them: processing names them the processor. */
export interface ResultsViewer {
  id: string;
  fullName: string;
}

export interface ExamsResultsOptions {
  /** The same objects `examsSetupModule` serves: every lifecycle action moves `status`, and the
   * exam page's own `GET /exams/{id}` then shows it. */
  exams: Exam[];
  /** What a processing run computes, per student of the exam. */
  computed: ComputedResult[];
  /** The signed-in user (`authUser`): the processor a run stamps, and the approver it checks. */
  viewer: ResultsViewer;
  results?: ExamResult[];
  /** The subjects with marks outstanding, as `assert_ready_to_process` names them
   * ("Mathematics (1 student(s))"); any refuses processing. */
  outstanding?: string[];
}

/** `ExamStatus`' labels, lower-cased as the services' refusals print `get_status_display()`. */
export const EXAM_STATUS_DISPLAY: Record<ExamStatus, string> = {
  draft: "draft",
  scheduled: "scheduled",
  ongoing: "ongoing",
  marks_entry: "marks entry",
  processing: "processing",
  approved: "approved",
  published: "published",
  archived: "archived",
};

/** A handler for one `/exams/{id}:<action>`, given the exam it addresses. */
export type ExamActionHandler = (exam: Exam, request: MockRequest) => MockResponse;

/** A queued job as `GET /jobs/{id}` serves it: already succeeded, with its `result`. */
interface QueuedJob {
  jobType: string;
  result: Record<string, unknown>;
}

/**
 * The state `examsResultsModule` and `examsReportCardsModule` share, built once per test by
 * `examsResultsState`: the exams and results both read, the jobs both queue (served by the one
 * `GET /jobs/{id}`), the `Idempotency-Key` replays, and the exam actions the report-cards module
 * adds to the one `POST /exams/:examAction`. Neither module keeps a copy of its own.
 */
export interface ExamsResultsState {
  exams: Exam[];
  computed: ComputedResult[];
  viewer: ResultsViewer;
  results: ExamResult[];
  outstanding: string[];
  jobs: Map<string, QueuedJob>;
  /** Actions beyond the results lifecycle, by name (`generate-report-cards`). */
  examActions: Map<string, ExamActionHandler>;
  findExam: (examId: string | undefined) => Exam | undefined;
  resultsOf: (exam: Exam) => ExamResult[];
  /** Queues a succeeded job with `result` and returns its id. */
  queueJob: (jobType: string, result: Record<string, unknown>) => string;
  /** Runs a `202` action once per `Idempotency-Key`, replaying its first answer after. */
  once: (key: string | undefined, run: () => MockResponse) => MockResponse;
}

export function examsResultsState(options: ExamsResultsOptions): ExamsResultsState {
  const results = [...(options.results ?? [])];
  const jobs = new Map<string, QueuedJob>();
  const replays = new Map<string, MockResponse>();
  return {
    exams: options.exams,
    computed: options.computed,
    viewer: options.viewer,
    results,
    outstanding: options.outstanding ?? [],
    jobs,
    examActions: new Map(),
    findExam: (examId) => options.exams.find((row) => row.id === examId),
    resultsOf: (exam) => results.filter((row) => row.exam_id === exam.id),
    queueJob: (jobType, result) => {
      const jobId = uuid();
      jobs.set(jobId, { jobType, result });
      return jobId;
    },
    once: (key, run) => {
      const replay = key ? replays.get(key) : undefined;
      if (replay) return replay;
      const answer = run();
      if (key && answer.status === 202) replays.set(key, answer);
      return answer;
    },
  };
}
