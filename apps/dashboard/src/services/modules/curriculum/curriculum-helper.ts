import { copyMappedFields } from "@/lib/helpers";
import {
  CURRICULUM_BODY_FIELDS,
  CURRICULUM_CREATE_ERROR_FIELDS,
  CURRICULUM_EDIT_ERROR_FIELDS,
  CURRICULUM_ELECTIVE_GROUP_FIELD,
  CURRICULUM_KIND,
  CURRICULUM_MIN_WEEKLY_PERIODS,
  CURRICULUM_QUERY_FIELDS,
} from "./curriculum-constant";
import type { CurriculumFormValues } from "./curriculum.schema";
import type { CurriculumInput, CurriculumPageQuery, CurriculumRecord } from "./curriculum-type";

/**
 * The curriculum module's pure helper functions — plain data in, plain data out; no React,
 * no API calls.
 */

/**
 * camelCase `CurriculumInput` -> the API's snake_case body, for both create and a partial
 * update. Gated on `!== undefined`, not truthiness: `campus_id: null` ("all campuses") and
 * `is_elective: false` are real values that have to reach the server.
 */
export function toCurriculumBody(input: Partial<CurriculumInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, CURRICULUM_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

/**
 * `CurriculumPageQuery` -> the `/class-subjects` list endpoint's query params. Unset and
 * empty-string filters are omitted ("no filter"); `isElective: false` is kept, since it
 * filters to core subjects.
 */
export function toCurriculumQueryParams(
  query: CurriculumPageQuery,
): Record<string, string | number | boolean | undefined> {
  const params: Record<string, unknown> = { page: query.page, page_size: query.pageSize };
  copyMappedFields(
    query,
    CURRICULUM_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as Record<string, string | number | boolean | undefined>;
}

/** The kind filter -> the API's `is_elective` filter: `all` (or anything else) is no filter. */
export function kindToIsElective(kind: string): boolean | undefined {
  if (kind === CURRICULUM_KIND.core) return false;
  if (kind === CURRICULUM_KIND.elective) return true;
  return undefined;
}

/**
 * The fields a server error may be shown under on the form. The group input is mounted only
 * while the switch is on, so with it off an error naming the group has no input to show under:
 * it is left out, and the caller shows that error as the form's own message instead.
 */
export function curriculumErrorFields(
  mode: "create" | "edit",
  isElective: boolean,
): readonly string[] {
  const fields: readonly string[] =
    mode === "edit" ? CURRICULUM_EDIT_ERROR_FIELDS : CURRICULUM_CREATE_ERROR_FIELDS;
  return isElective ? fields : fields.filter((field) => field !== CURRICULUM_ELECTIVE_GROUP_FIELD);
}

/** A new mapping's form values: the screen's session picked, everything else empty. */
export function defaultCurriculumFormValues(academicSessionId: string): CurriculumFormValues {
  return {
    academic_session_id: academicSessionId,
    class_id: "",
    subject_id: "",
    campus_id: "",
    is_elective: false,
    elective_group: "",
    weekly_periods: CURRICULUM_MIN_WEEKLY_PERIODS,
    notes: "",
  };
}

/** An existing mapping's form values; a null campus is `""` ("all campuses"). */
export function recordToFormValues(record: CurriculumRecord): CurriculumFormValues {
  return {
    academic_session_id: record.academic_session_id,
    class_id: record.class_id,
    subject_id: record.subject_id,
    campus_id: record.campus_id ?? "",
    is_elective: record.is_elective ?? false,
    elective_group: record.elective_group ?? "",
    weekly_periods: record.weekly_periods ?? CURRICULUM_MIN_WEEKLY_PERIODS,
    notes: record.notes ?? "",
  };
}

/** Trimmed, with a blank as `null`: the wire's "nothing here", which clears a stored value. */
function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Form values -> the service input. `create` sends every field. `edit` sends only the four
 * the API lets a mapping change (session, class, subject and campus identify it, so they are
 * never sent). A group is sent only for an elective, so toggling the switch off clears it.
 */
export function buildCurriculumInput(values: CurriculumFormValues, mode: "create"): CurriculumInput;
export function buildCurriculumInput(
  values: CurriculumFormValues,
  mode: "edit",
): Partial<CurriculumInput>;
export function buildCurriculumInput(
  values: CurriculumFormValues,
  mode: "create" | "edit",
): CurriculumInput | Partial<CurriculumInput> {
  const editable = {
    isElective: values.is_elective,
    electiveGroup: values.is_elective ? blankToNull(values.elective_group) : null,
    weeklyPeriods: values.weekly_periods,
    notes: blankToNull(values.notes),
  };
  if (mode === "edit") return editable;
  return {
    academicSessionId: values.academic_session_id,
    classId: values.class_id,
    subjectId: values.subject_id,
    campusId: values.campus_id === "" ? null : values.campus_id,
    ...editable,
  };
}
