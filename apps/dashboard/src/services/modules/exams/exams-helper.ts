import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import {
  CONFIGURABLE_EXAM_STATUSES,
  DEFAULT_EXAM_TYPE,
  DEFAULT_WEIGHTAGE_PERCENT,
  DELETABLE_EXAM_STATUS,
  EXAM_STATUS_ORDER,
  EXAMS_BODY_FIELDS,
  EXAMS_QUERY_FIELDS,
  SKIPPABLE_EXAM_STATUSES,
} from "./exams-constant";
import type { ExamFormValues } from "./exams.schema";
import type { ExamInput, ExamPageQuery, ExamRecord, ExamStatus } from "./exams-type";

/** The exams module's pure helpers: plain data in, plain data out. */

export function toExamBody(input: Partial<ExamInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, EXAMS_BODY_FIELDS, (value) => value !== undefined, body);
  // No scale named: the server picks the school's default (create) or keeps the exam's (edit).
  if (!input.gradingScaleId) delete body.grading_scale_id;
  return body;
}

export function toExamQueryParams(
  query: ExamPageQuery,
): Record<string, string | number | undefined> {
  const params: Record<string, unknown> = { page: query.page, page_size: query.pageSize };
  copyMappedFields(
    query,
    EXAMS_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as Record<string, string | number | undefined>;
}

/** A URL filter value -> the query's value: `all` is no filter. */
export function filterToValue(filter: string): string | undefined {
  return filter === FILTER_ALL ? undefined : filter;
}

/** Trimmed, with a blank as `null`, which clears a stored value. */
function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function defaultExamFormValues(academicSessionId = ""): ExamFormValues {
  return {
    name: "",
    academic_session_id: academicSessionId,
    term_id: "",
    exam_type: DEFAULT_EXAM_TYPE,
    grading_scale_id: "",
    weightage_percent: DEFAULT_WEIGHTAGE_PERCENT,
    starts_on: "",
    ends_on: "",
    description: "",
  };
}

export function recordToExamFormValues(record: ExamRecord): ExamFormValues {
  return {
    name: record.name,
    academic_session_id: record.academic_session_id,
    term_id: record.term_id ?? "",
    exam_type: record.exam_type,
    grading_scale_id: record.grading_scale_id ?? "",
    weightage_percent: record.weightage_percent ?? DEFAULT_WEIGHTAGE_PERCENT,
    starts_on: record.starts_on ?? "",
    ends_on: record.ends_on ?? "",
    description: record.description ?? "",
  };
}

export function buildExamInput(values: ExamFormValues): ExamInput {
  return {
    name: values.name.trim(),
    academicSessionId: values.academic_session_id,
    termId: blankToNull(values.term_id),
    examType: values.exam_type,
    gradingScaleId: blankToNull(values.grading_scale_id),
    weightagePercent: values.weightage_percent.trim(),
    startsOn: blankToNull(values.starts_on),
    endsOn: blankToNull(values.ends_on),
    description: blankToNull(values.description),
  };
}

/** Whether the exam's configuration (the exam, its subjects) can still change. */
export function isExamConfigurable(status: ExamStatus): boolean {
  return CONFIGURABLE_EXAM_STATUSES.includes(status);
}

/** Whether the exam may be deleted: a draft only. */
export function isExamDeletable(status: ExamStatus): boolean {
  return status === DELETABLE_EXAM_STATUS;
}

export type StepState = "done" | "current" | "upcoming" | "skipped";

/** One status's place in the stepper, given the exam's own: a status before the exam's is
 * done, except a skippable one, which nothing sets and so is shown as skipped. */
export function stepState(step: ExamStatus, current: ExamStatus): StepState {
  if (step === current) return "current";
  if (EXAM_STATUS_ORDER[step] > EXAM_STATUS_ORDER[current]) return "upcoming";
  return SKIPPABLE_EXAM_STATUSES.includes(step) ? "skipped" : "done";
}
