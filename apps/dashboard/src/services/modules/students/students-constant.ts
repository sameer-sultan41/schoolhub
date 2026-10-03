import type { StudentsPageQuery, UpdateStudentInput } from "./students-type";

/** The students module's constants — collected here so every feature file under
 * `src/features/students/` shares one definition instead of repeating the literal. */

/** The one status a student can be withdrawn from, and the directory's default status
 * filter. */
export const STUDENT_WITHDRAWABLE_STATUS = "active";

/** Sentinel for "no filter" in a directory `Select` — the actual query omits the param
 * entirely rather than sending this literal string. */
export const STUDENT_FILTER_ALL = "all";

/** Sentinel for "no house selected" in the student form — mirrors `STUDENT_FILTER_ALL`'s
 * role but for the form's House field, which has no real `"unset"` API value. */
export const UNSET_VALUE = "unset";

/** Column id -> the real `?ordering=` field name the `/students` list endpoint accepts. */
export const SORT_FIELD: Record<string, string> = {
  name: "last_name",
  admissionNumber: "admission_number",
  admissionDate: "admission_date",
  status: "status",
  campus: "campus_name",
};

/** camelCase `UpdateStudentInput` key -> the API's snake_case body key. Drives
 * `toStudentBody` (`students-helper.ts`) — kept here, not inline in that function, so
 * every field-name mapping in the module has one place a reviewer can check. */
export const STUDENT_BODY_FIELDS: ReadonlyArray<readonly [keyof UpdateStudentInput, string]> = [
  ["firstName", "first_name"],
  ["lastName", "last_name"],
  ["dateOfBirth", "date_of_birth"],
  ["gender", "gender"],
  ["campusId", "campus_id"],
  ["admissionDate", "admission_date"],
  ["preferredName", "preferred_name"],
  ["houseId", "house_id"],
  ["photoFileId", "photo_file_id"],
  ["bloodGroup", "blood_group"],
  ["nationality", "nationality"],
  ["religion", "religion"],
  ["previousSchool", "previous_school"],
  ["medicalNotes", "medical_notes"],
  ["address", "address"],
];

/** camelCase `StudentsPageQuery` key -> the `/students` list endpoint's `?`-string
 * param name. Drives `toStudentsQueryParams` (`students-helper.ts`); `page`/`page_size`
 * aren't here since they're always sent, never conditionally included. */
export const STUDENTS_QUERY_FIELDS: ReadonlyArray<readonly [keyof StudentsPageQuery, string]> = [
  ["search", "search"],
  ["ordering", "ordering"],
  ["status", "status"],
  ["campusId", "campus_id"],
  ["houseId", "house_id"],
];
