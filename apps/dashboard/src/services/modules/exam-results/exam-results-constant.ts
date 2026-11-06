import { FILTER_ALL } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import { EXAMS_QUERY_MODULE } from "@/services/modules/exams/exams-constant";
import type { ExamStatus } from "@/services/modules/exams/exams-type";
import type { ResultOutcome, ResultPageQuery, ResultStatus } from "./exam-results-type";

/** The exam-results module's constants. */

/** Results sit under the exams module's key: every lifecycle action moves the exam's status, so
 * one invalidation refreshes the exam, its stepper and its results together. */
export const RESULTS_QUERY_MODULE = EXAMS_QUERY_MODULE;
export const RESULTS_LIST_RESOURCE = "results";
/** The exam tab's id (`?tab=results`). */
export const RESULTS_TAB_ID = "results";
/** The one pending row the lifecycle bar reads its processor from. */
export const RESULTS_PENDING_RESOURCE = "results-pending";
/** One student's subject marks, the detail sheet's read. */
export const STUDENT_MARKS_RESOURCE = "student-marks";
/** Namespaces the processing job's poll (`useJobPolling`). */
export const RESULTS_JOB_MODULE = "exam-results";

/** Rows per page: the cursor list has no page-size picker. */
export const RESULTS_PAGE_SIZE = 25;
/** Highest percentage first (`ordering_fields`), so each section's ranks read top-down. */
export const RESULTS_ORDERING = "-percentage";

/** The 409 code for processing refused while marks are outstanding (`processing.MarksOutstanding`):
 * the only one of the exam's 409s that sends the user to the Marks tab. */
export const MARKS_OUTSTANDING_CODE = "marks_outstanding";

export const RESULT_STATUS_PENDING: ResultStatus = "pending_approval";
export const RESULT_STATUS_PUBLISHED: ResultStatus = "published";
export const RESULT_OUTCOME_WITHHELD: ResultOutcome = "withheld";

/** Every status and outcome, keyed so the compiler checks each set against its generated enum. */
const STATUS_SET: Record<ResultStatus, true> = {
  processing: true,
  pending_approval: true,
  approved: true,
  published: true,
};
export const RESULT_STATUSES = Object.keys(STATUS_SET) as ResultStatus[];

const OUTCOME_SET: Record<ResultOutcome, true> = {
  pass: true,
  fail: true,
  absent: true,
  withheld: true,
};
export const RESULT_OUTCOMES = Object.keys(OUTCOME_SET) as ResultOutcome[];

const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...RESULT_STATUSES];
const OUTCOME_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...RESULT_OUTCOMES];

/** The tab's URL filters (`useDataGridUrlState`): every result of every section by default. */
export const RESULT_URL_FILTERS = {
  section: { default: "", isValid: (value: string) => value === "" || isUuid(value) },
  outcome: {
    default: FILTER_ALL,
    isValid: (value: string) => OUTCOME_FILTER_VALUES.includes(value),
  },
  status: {
    default: FILTER_ALL,
    isValid: (value: string) => STATUS_FILTER_VALUES.includes(value),
  },
};

/** The list has no sortable column; the sort is fixed (`RESULTS_ORDERING`). */
export const RESULT_SORTABLE_IDS: readonly string[] = [];
export const RESULT_DEFAULT_SORTING: { id: string; desc: boolean }[] = [];
export const RESULT_ACTIONS_COLUMN_ID = "actions";

/** camelCase `ResultPageQuery` key -> the list's query param; the page size goes first. */
export const RESULT_QUERY_FIELDS: ReadonlyArray<readonly [keyof ResultPageQuery, string]> = [
  ["examId", "exam_id"],
  ["cursor", "cursor"],
  ["ordering", "ordering"],
  ["sectionId", "section_id"],
  ["outcome", "outcome"],
  ["status", "status"],
];

/** `ResultWithholdSerializer.reason` and `SendResultsBackSerializer.reason` `max_length`s. */
export const WITHHOLD_REASON_MAX_LENGTH = 255;
export const SEND_BACK_REASON_MAX_LENGTH = 500;
/** The fields a server error may name on a reason form: the reason is its only input. */
export const REASON_ERROR_FIELDS = ["reason"] as const;

/** Processing runs, and re-runs, until approval (`services.RECOMPUTABLE_EXAM_STATUSES`). */
export const PROCESSABLE_EXAM_STATUSES: readonly ExamStatus[] = [
  "scheduled",
  "ongoing",
  "marks_entry",
  "processing",
];
/** Approval needs processed results (`approve_exam_results`). */
export const APPROVABLE_EXAM_STATUS: ExamStatus = "processing";
/** Sending back reopens processed or approved results (`send_results_back`). */
export const SEND_BACK_EXAM_STATUSES: readonly ExamStatus[] = ["processing", "approved"];
/** Publishing releases approved results (`publish_exam_results`). */
export const PUBLISHABLE_EXAM_STATUS: ExamStatus = "approved";
