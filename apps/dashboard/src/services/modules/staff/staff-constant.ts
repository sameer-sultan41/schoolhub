import { GENDER_VALUES } from "@schoolhub/types";
import type { StaffDirectoryQuery, UpdateStaffInput } from "./staff-type";

/**
 * The staff module's constants — collected here so every feature file under
 * `src/features/staff/` shares one definition instead of repeating the literal.
 */

/** `/staff`'s own hard page-size ceiling (api-architecture.md §2.4). */
export const MAX_PAGE_SIZE = 100;

/**
 * Column id -> the real `?ordering=` field name confirmed against `StaffViewSet.
 * ordering_fields` (apps/api/apps/staff_management/views.py). `joiningDate` is not a
 * real column — it is the sentinel id the Sort Order popover writes into `sorting`
 * state. There is no entry for the "Last updated" column: `updated_at` is not in
 * `ordering_fields` (only `created_at` is), so that column is built with
 * `enableSorting: false` rather than wiring a sort that would silently do nothing on
 * the server.
 */
export const SORT_FIELD: Record<string, string> = {
  name: "last_name",
  role: "designation_name",
  status: "employment_status",
  campus: "campus_name",
  joiningDate: "joining_date",
};

export const DEFAULT_SORTING = [{ id: "name", desc: false }];
export const JOINING_DATE_SORT_ID = "joiningDate";

export type StatusVariant = "success" | "warning" | "destructive" | "secondary" | "info" | "rose";

/** employment_status -> badge; mirrors EmploymentStatus in staff_management/models.py. */
export const STATUS_META: Record<string, { variant: StatusVariant; label: string }> = {
  active: { variant: "success", label: "Active" },
  on_leave: { variant: "warning", label: "On leave" },
  suspended: { variant: "destructive", label: "Suspended" },
  resigned: { variant: "rose", label: "Resigned" },
  retired: { variant: "info", label: "Retired" },
  terminated: { variant: "destructive", label: "Terminated" },
};

/**
 * Options derived from the shared `GENDER_VALUES` (`@schoolhub/types`) — the same
 * source students' own form uses — so the value set can't drift from it. Labels stay
 * hardcoded English here (not `t(`gender.${value}`)`): this route has no i18n wiring
 * at all yet (see `staff-directory-table.tsx`'s own comment on that).
 */
const GENDER_LABELS: Record<(typeof GENDER_VALUES)[number], string> = {
  male: "Male",
  female: "Female",
  other: "Other",
  unspecified: "Unspecified",
};
export const GENDER_OPTIONS = GENDER_VALUES.map((value) => ({
  value,
  label: GENDER_LABELS[value],
}));

export const STAFF_TYPE_OPTIONS = [
  { value: "teaching", label: "Teaching" },
  { value: "non_teaching", label: "Non-teaching" },
];

export const EMPLOYMENT_TYPE_OPTIONS = [
  { value: "full_time", label: "Full time" },
  { value: "part_time", label: "Part time" },
  { value: "contract", label: "Contract" },
  { value: "visiting", label: "Visiting" },
];

/**
 * Sentinel for "no department/designation/manager/employment type" in a `<Select>` —
 * Radix disallows a real `<SelectItem value="">`, so an explicit "None" choice needs a
 * non-empty value of its own. `buildStaffInput` maps both this and a genuinely
 * untouched `""` back to `undefined`/`null` before anything is sent to
 * `createStaff`/`updateStaff`.
 */
export const UNSET_VALUE = "unset";

/**
 * Real enum values, `ExitRequestSerializer` (`apps/api/apps/staff_management/
 * serializers.py:253`). No pre-selected default — the server itself defaults to
 * `"resigned"` when the field is omitted from the request body entirely.
 */
export const EXIT_TYPE_OPTIONS = [
  { value: "resigned", label: "Resigned" },
  { value: "retired", label: "Retired" },
  { value: "terminated", label: "Terminated" },
];

export const EXIT_REASON_MAX_LENGTH = 300;

/** The download-name hint for the staff CSV export (see `downloadFile`). */
export const STAFF_EXPORT_FILENAME = "staff-export.csv";

/** Per user as well as per tab: a different sign-in in the same tab never reconnects
 * to someone else's import. */
export const STAFF_IMPORT_JOB_STORAGE_PREFIX = "schoolhub:staff-import-job:";
/** Mirrors `REQUIRED_IMPORT_COLUMNS`/`IMPORT_COLUMNS`
 * (`apps/api/apps/staff_management/staff/services/import_staff.py`) verbatim — shown
 * so the person picking a file knows the header row's exact contract before they
 * upload it. */
export const STAFF_IMPORT_REQUIRED_COLUMNS = [
  "first_name",
  "last_name",
  "staff_type",
  "campus_code",
  "joining_date",
  "phone",
];
export const STAFF_IMPORT_OPTIONAL_COLUMNS = ["gender", "date_of_birth", "email", "national_id"];

/**
 * Which predicate `toStaffBody` (`staff-helper.ts`) applies to a field's value before
 * copying it: `"truthy"` (an empty string is never sent — the six fields that behave
 * like required fields, always present on create, truthy-gated on update so an empty
 * string never silently blanks one via PATCH) or `"defined"` (`!== undefined`, so a
 * caller can explicitly clear a nullable field with `null`). The gate travels with
 * the field in one row — not implied by which of two separate arrays a field was
 * placed in, which had no way to catch a field landing in the wrong one.
 */
export type StaffBodyFieldGate = "truthy" | "defined";

/** camelCase `UpdateStaffInput` key -> the API's snake_case body key -> its gate. */
export const STAFF_BODY_FIELDS: ReadonlyArray<
  readonly [keyof UpdateStaffInput, string, StaffBodyFieldGate]
> = [
  ["campusId", "campus_id", "truthy"],
  ["joiningDate", "joining_date", "truthy"],
  ["firstName", "first_name", "truthy"],
  ["lastName", "last_name", "truthy"],
  ["staffType", "staff_type", "truthy"],
  ["phone", "phone", "truthy"],
  ["departmentId", "department_id", "defined"],
  ["designationId", "designation_id", "defined"],
  ["reportsToStaffId", "reports_to_staff_id", "defined"],
  ["userId", "user_id", "defined"],
  ["photoFileId", "photo_file_id", "defined"],
  ["gender", "gender", "defined"],
  ["dateOfBirth", "date_of_birth", "defined"],
  ["employmentType", "employment_type", "defined"],
  ["email", "email", "defined"],
  ["nationalId", "national_id", "defined"],
  ["publicBio", "public_bio", "defined"],
  ["address", "address", "defined"],
];

/** camelCase `StaffDirectoryQuery` key -> the `/staff` list endpoint's `?`-string
 * param name. `page`/`pageSize` are included here (unlike students' own
 * `STUDENTS_QUERY_FIELDS`) since `fetchStaffPage` truthy-gates them too — the toolbar
 * calls it with only `{ pageSize: 1 }`. */
export const STAFF_QUERY_FIELDS: ReadonlyArray<readonly [keyof StaffDirectoryQuery, string]> = [
  ["page", "page"],
  ["pageSize", "page_size"],
  ["search", "search"],
  ["ordering", "ordering"],
  ["employmentStatus", "employment_status"],
];
