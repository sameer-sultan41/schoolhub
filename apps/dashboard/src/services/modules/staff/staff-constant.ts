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
 * Real enum values, verified against `apps/api/apps/staff_management/models.py` — used
 * verbatim as each `<Select>`'s options, never invented client-side.
 */
export const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "unspecified", label: "Unspecified" },
];

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

export const ACCEPTED_EXTENSIONS = ".csv,.xlsx";
/** Per user as well as per tab: a different sign-in in the same tab never reconnects
 * to someone else's import. */
export const ACTIVE_JOB_STORAGE_PREFIX = "schoolhub:staff-import-job:";
/** Mirrors `REQUIRED_IMPORT_COLUMNS`/`IMPORT_COLUMNS`
 * (`apps/api/apps/staff_management/staff/services/import_staff.py`) verbatim — shown
 * so the person picking a file knows the header row's exact contract before they
 * upload it. */
export const REQUIRED_COLUMNS = [
  "first_name",
  "last_name",
  "staff_type",
  "campus_code",
  "joining_date",
  "phone",
];
export const OPTIONAL_COLUMNS = ["gender", "date_of_birth", "email", "national_id"];

/**
 * camelCase `UpdateStaffInput` key -> the API's snake_case body key, for the six
 * fields that behave like required fields (always present on create, truthy-gated on
 * update so an empty string never silently blanks one via PATCH). Drives
 * `toStaffCreateBody`/`toStaffUpdateBody` (`staff-helper.ts`).
 */
export const STAFF_REQUIRED_LIKE_FIELDS: ReadonlyArray<readonly [keyof UpdateStaffInput, string]> =
  [
    ["campusId", "campus_id"],
    ["joiningDate", "joining_date"],
    ["firstName", "first_name"],
    ["lastName", "last_name"],
    ["staffType", "staff_type"],
    ["phone", "phone"],
  ];

/**
 * camelCase `UpdateStaffInput` key -> the API's snake_case body key, for the
 * genuinely-optional fields — gated on `!== undefined` so a caller can explicitly
 * clear one with `""`/`null`.
 */
export const STAFF_OPTIONAL_FIELDS: ReadonlyArray<readonly [keyof UpdateStaffInput, string]> = [
  ["departmentId", "department_id"],
  ["designationId", "designation_id"],
  ["reportsToStaffId", "reports_to_staff_id"],
  ["userId", "user_id"],
  ["photoFileId", "photo_file_id"],
  ["gender", "gender"],
  ["dateOfBirth", "date_of_birth"],
  ["employmentType", "employment_type"],
  ["email", "email"],
  ["nationalId", "national_id"],
  ["publicBio", "public_bio"],
  ["address", "address"],
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
