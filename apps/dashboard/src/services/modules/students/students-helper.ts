import { copyMappedFields, formatLastUpdated, stableSignedUrl } from "@/lib/helpers";
import { STUDENT_BODY_FIELDS, STUDENTS_QUERY_FIELDS } from "./students-constant";
import type {
  StudentRecord,
  StudentRow,
  StudentsPageQuery,
  UpdateStudentInput,
} from "./students-type";

export { formatLastUpdated };

/**
 * The students module's pure helper functions — single source of truth, so a mapper or
 * formatter isn't reimplemented per feature file. Everything here is plain data in,
 * plain data out; no React, no API calls.
 */

/** The directory table's row shape, derived from the generated `StudentRecord`. */
export function toStudentRow(record: StudentRecord): StudentRow {
  return {
    id: record.id,
    // The generated schema types this optional (admission_number can, in principle, be
    // unset between a PATCH request and the server allocating one) — the API never
    // actually returns a student without one, but `?? ""` keeps the row's own type honest.
    admissionNumber: record.admission_number ?? "",
    name: [record.first_name, record.last_name].join(" "),
    status: record.status,
    campus: record.campus_name,
    house: record.house_name,
    admissionDate: record.admission_date,
    updatedAt: record.updated_at,
    signedPhotoUrl: stableSignedUrl(record.photo_url) ?? undefined,
  };
}

/**
 * camelCase `CreateStudentInput`/`UpdateStudentInput` -> the API's snake_case body.
 * Shared by `createStudent` and `updateStudent` — `CreateStudentInput`'s required
 * fields are always defined, so gating every field on `!== undefined` (rather than
 * truthy) is safe for both callers and, for `updateStudent`, is the whole point: a
 * caller sending an explicit `null` must reach the request body rather than being
 * silently dropped the same way an empty string or `0` would be under a truthy check.
 */
export function toStudentBody(input: UpdateStudentInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, STUDENT_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

/** `StudentsPageQuery` -> the `/students` list endpoint's `?`-string params. Every
 * filter is optional and falsy-omitted (an empty string/`undefined` means "no
 * filter"), unlike `toStudentBody`'s `!== undefined` check — there is no "explicitly
 * clear this filter" case a list query needs to distinguish from "not set". */
export function toStudentsQueryParams(query: StudentsPageQuery): Record<string, string | number> {
  const params: Record<string, unknown> = { page: query.page, page_size: query.pageSize };
  copyMappedFields(query, STUDENTS_QUERY_FIELDS, Boolean, params);
  return params as Record<string, string | number>;
}
