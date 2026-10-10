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
  ["academicSessionId", "academic_session_id"],
  ["classId", "class_id"],
  ["sectionId", "section_id"],
];

export const DOCUMENT_TYPES = [
  "birth_certificate",
  "prior_transfer_certificate",
  "immunization_record",
  "photo_id",
  "prior_report_card",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Mirror `REQUIRED_IMPORT_COLUMNS`/`IMPORT_COLUMNS`
 * (`apps/api/apps/student_management/services.py`) verbatim — shown so the person picking a
 * file knows the header row's exact contract before they upload it. `campus_code` (not an
 * id) is what the importer resolves to a campus. */
export const STUDENT_IMPORT_REQUIRED_COLUMNS = [
  "first_name",
  "last_name",
  "date_of_birth",
  "gender",
  "campus_code",
  "admission_date",
] as const;
export const STUDENT_IMPORT_OPTIONAL_COLUMNS = [
  "preferred_name",
  "blood_group",
  "nationality",
  "religion",
  "previous_school",
] as const;

/** Per user as well as per tab: a different sign-in in the same tab never reconnects to
 * someone else's import. */
export const STUDENT_IMPORT_JOB_STORAGE_PREFIX = "schoolhub:students-import-job:";

/** Download-name hints for the export CSV and the batch ID-card PDF (see `downloadFile`). */
export const STUDENT_EXPORT_FILENAME = "students-export.csv";
export const ID_CARDS_FILENAME = "id-cards.pdf";

/** Nested under one student — a handful of rows, fetched in one page. Matches the real
 * `EmergencyContactLinkViewSet`/`StudentDocumentLinkViewSet` precedent: both are
 * nested-under-one-student lists with no independent pagination UI. */
export const RELATION_PAGE_SIZE = 50;
