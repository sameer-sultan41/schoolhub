import type { QueryParams } from "@schoolhub/api-client";
import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import {
  DEFAULT_SCHOLARSHIP_COVERAGE,
  DEFAULT_SCHOLARSHIP_INITIAL_STATUS,
  DEFAULT_SCHOLARSHIP_TYPE,
  SCHOLARSHIP_NEXT_STATES,
  SCHOLARSHIP_NOTES_REQUIRED,
  SCHOLARSHIPS_BODY_FIELDS,
  SCHOLARSHIPS_QUERY_FIELDS,
} from "./scholarships-constant";
import type { ScholarshipFormValues } from "./scholarships.schema";
import type { ScholarshipInput, ScholarshipsQuery, ScholarshipStatus } from "./scholarships-type";

/** The scholarships module's pure helpers: plain data in, plain data out. */

/** The list's query string: only the filters given are sent. */
export function toScholarshipsQueryParams(query: ScholarshipsQuery): QueryParams {
  const params: Record<string, unknown> = {};
  copyMappedFields(
    query,
    SCHOLARSHIPS_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as QueryParams;
}

/** A create or update body: only the fields given, in the API's snake_case. `null` clears a nullable field. */
export function toScholarshipBody(input: Partial<ScholarshipInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, SCHOLARSHIPS_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

/** A URL filter's picked status, or `undefined` for "all" (no filter sent). */
export function scholarshipStatusFilter(value: string): ScholarshipStatus | undefined {
  return value === FILTER_ALL ? undefined : (value as ScholarshipStatus);
}

/** The statuses an award may move to from `status`: the server's table, so the UI never offers a refused move. */
export function nextScholarshipStatuses(status: ScholarshipStatus): readonly ScholarshipStatus[] {
  return status in SCHOLARSHIP_NEXT_STATES ? SCHOLARSHIP_NEXT_STATES[status] : [];
}

/** Whether moving to `status` must carry `notes`. */
export function scholarshipNotesRequired(status: ScholarshipStatus): boolean {
  return SCHOLARSHIP_NOTES_REQUIRED.includes(status);
}

export function defaultScholarshipFormValues(): ScholarshipFormValues {
  return {
    student: "",
    academic_session: "",
    name: "",
    scholarship_type: DEFAULT_SCHOLARSHIP_TYPE,
    coverage_type: DEFAULT_SCHOLARSHIP_COVERAGE,
    value: "",
    sponsor: "",
    status: DEFAULT_SCHOLARSHIP_INITIAL_STATUS,
    notes: "",
  };
}

/** A blank optional field is sent as `null`, so the server stores nothing rather than an empty string. */
export function buildScholarshipInput(values: ScholarshipFormValues): ScholarshipInput {
  return {
    studentId: values.student,
    academicSessionId: values.academic_session,
    name: values.name.trim(),
    scholarshipType: values.scholarship_type,
    coverageType: values.coverage_type,
    value: values.value.trim(),
    sponsor: values.sponsor.trim() || null,
    status: values.status,
    notes: values.notes.trim() || null,
  };
}
