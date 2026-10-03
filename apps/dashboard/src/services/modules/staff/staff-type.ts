/**
 * The staff module's domain types — single source of truth, so a type isn't
 * redeclared in more than one file. These are hand-written, not
 * `ApiSchemas["Staff"]`-derived aliases (a pre-existing ADR-0017 gap, tracked in
 * `docs/deferred-work.md` — out of scope for this file-organization change).
 */

export interface StaffDirectoryRecord {
  id: string;
  first_name: string;
  last_name: string;
  designation_name: string | null;
  department_name: string | null;
  campus_name: string;
  staff_type: "teaching" | "non_teaching";
  employment_status: string;
  updated_at: string;
  /** Signed display link for the staff photo (`StaffSerializer.photo_url`), or `null` when
   * there is none or its upload isn't confirmed. It expires (1 h) and can fail to load, so
   * always render it over an initials fallback. */
  photo_url: string | null;
  // Both real fields on `StaffSerializer` (`apps/api/apps/staff_management/
  // serializers.py`'s `Meta.fields`), read-only there and set only by the `:exit`
  // colon-action — never a plain PATCH. Included here (optional, since a listing
  // response for an active staff member won't have them set) so `exitStaff`'s own
  // return value carries them without a second, exit-only response type; the
  // directory table itself has no reason to read either field yet.
  exit_date?: string | null;
  exit_reason?: string | null;
}

export interface StaffDirectoryQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  ordering?: string;
  employmentStatus?: string;
}

/**
 * The staff form's own input shape — camelCase, as every other input type in this
 * codebase is — mapped to the real snake_case body `create_staff`
 * (`apps/api/apps/staff_management/services.py:274`) expects. `employee_number` is
 * deliberately absent: it's server-generated on create, never sent by a caller.
 */
export interface CreateStaffInput {
  campusId: string;
  joiningDate: string; // ISO date, YYYY-MM-DD
  firstName: string;
  lastName: string;
  staffType: "teaching" | "non_teaching";
  phone: string;
  // `| null` (unlike every other optional field below): the API's own field is a
  // nullable FK (`PrimaryKeyRelatedField(allow_null=True)`), so an explicit `null`
  // is how a caller says "clear this relation" — `undefined` still means "leave alone."
  departmentId?: string | null;
  designationId?: string | null;
  reportsToStaffId?: string | null;
  userId?: string;
  photoFileId?: string;
  gender?: string;
  dateOfBirth?: string;
  employmentType?: string;
  email?: string;
  nationalId?: string;
  publicBio?: string;
  address?: Record<string, unknown>;
}

/**
 * Same field set as `CreateStaffInput`, all optional — a `PATCH` only sends what
 * changed.
 */
export type UpdateStaffInput = Partial<CreateStaffInput>;

/**
 * `POST /staff/{id}:exit` input — a colon-action, not a nested `/staff/{id}/exit` path
 * (the real registered route, `apps/api/apps/staff_management/urls.py:45`). Body
 * validated server-side by `ExitRequestSerializer`
 * (`apps/api/apps/staff_management/serializers.py:253`); `exitType` is left out of the
 * body entirely when omitted (not sent as `undefined`/`""`) so the server's own default
 * of `"resigned"` actually applies.
 */
export interface ExitStaffInput {
  exitDate: string; // ISO date, YYYY-MM-DD
  exitReason: string;
  exitType?: "resigned" | "retired" | "terminated";
}

/**
 * The full field set the edit form needs to pre-fill — `StaffDirectoryRecord` above only
 * carries what the directory table displays. This is the real, complete
 * `StaffSerializer.Meta.fields` tuple (`apps/api/apps/staff_management/serializers.py`),
 * minus `exit_date`/`exit_reason` (real fields, but read-only outside the separate
 * `:exit` action) and minus `custom_fields`/`created_at`/`updated_at`.
 */
export interface StaffDetailRecord {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  gender: string | null;
  date_of_birth: string | null;
  photo_file_id: string | null;
  photo_url: string | null;
  staff_type: "teaching" | "non_teaching";
  campus_id: string;
  department_id: string | null;
  designation_id: string | null;
  reports_to_staff_id: string | null;
  employment_type: string | null;
  employment_status: string;
  joining_date: string;
  email: string | null;
  phone: string;
  national_id: string | null;
  public_bio: string | null;
  address: Record<string, unknown> | null;
}

/** The directory table's view-model row, derived from `StaffDirectoryRecord` by
 * `toStaffRow` (`staff-helper.ts`) and shared by the columns, detail sheet and
 * directory table. */
export interface StaffRow {
  id: string;
  name: string;
  designation: string;
  campus: string;
  status: string;
  updatedAt: string;
  photoUrl: string | null;
}
