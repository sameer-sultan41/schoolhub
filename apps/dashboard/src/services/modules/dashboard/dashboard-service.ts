import { collectPages, fetchPage, type Page } from "@schoolhub/api-client";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";

/**
 * The dashboard home screen's API calls. Every widget reaches these through
 * `Services.dashboard.*` (see `@/services`) — never by importing `@schoolhub/api-client`
 * or `@/lib/auth`'s `apiClient` directly.
 *
 * The wire types below are hand-declared, minimal subsets of the real API records (the
 * fuller `StaffRecord`/`MyTimetableSlot`/etc. types live in each feature module once one
 * exists — see AGENTS.md) — only the fields these widgets actually read.
 */

interface CountableRecord {
  id: string;
}

/**
 * Reads a count straight from the server's own `total_count` rather than draining pages.
 * Every reference list this dashboard counts (`/classes`, `/sections`, `/subjects`,
 * `/campuses`, `/students`, `/staff`) uses page-number pagination, confirmed directly
 * against a running API — `collectPages`/`paginate` only walk *cursor* pagination
 * (they follow `next_cursor`), so used against these endpoints they silently stop after
 * page one instead of reporting an error, undercounting any list bigger than one page.
 * `null` means the endpoint didn't report a total — never a fabricated zero.
 */
async function fetchTotal(path: string): Promise<number | null> {
  const page = await fetchPage<CountableRecord>(apiClient, path, { query: { page_size: 1 } });
  const pagination = page.pagination;
  if (!pagination || !("total_count" in pagination)) return null;
  return pagination.total_count ?? null;
}

export interface DashboardOverview {
  students: number | null;
  staff: number | null;
  classes: number | null;
  sections: number | null;
  subjects: number | null;
  campuses: number | null;
}

/** Headline counts shared by the School Snapshot and Reference Overview widgets. */
export async function fetchDashboardOverview(): Promise<DashboardOverview> {
  const [students, staff, classes, sections, subjects, campuses] = await Promise.all([
    fetchTotal(endpoints.dashboard.students),
    fetchTotal(endpoints.dashboard.staff),
    fetchTotal(endpoints.dashboard.classes),
    fetchTotal(endpoints.dashboard.sections),
    fetchTotal(endpoints.dashboard.subjects),
    fetchTotal(endpoints.dashboard.campuses),
  ]);
  return { students, staff, classes, sections, subjects, campuses };
}

export interface AcademicSessionSummary {
  id: string;
  name: string;
  status: string;
  is_current: boolean;
}

/** Every academic session — callers resolve the current one from this list. */
export async function fetchAcademicSessions(): Promise<AcademicSessionSummary[]> {
  return collectPages<AcademicSessionSummary>(apiClient, endpoints.dashboard.academicSessions);
}

export interface TeacherLoadSummaryRow {
  staff_id: string;
  name: string;
  weekly_periods: number;
  allocations: number;
  over_norm: boolean;
}

/** Weekly teaching load per teacher for one academic session. */
export async function fetchTeacherLoadSummary(
  academicSessionId: string,
): Promise<TeacherLoadSummaryRow[]> {
  const { data } = await apiClient.get<TeacherLoadSummaryRow[]>(
    endpoints.dashboard.teacherLoadSummary,
    { query: { academic_session_id: academicSessionId } },
  );
  return data;
}

export interface MyTimetableSlot {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  section_name: string;
  subject_name: string | null;
  staff_name: string | null;
  room_name: string | null;
}

/**
 * The viewer's own timetable slots for one date.
 *
 * The endpoint's own response is `{ data: MyTimetableSlot[], meta: { academic_session_id,
 * date, audience, ... } }` — the slot list is the top-level `data`, not nested under a
 * `slots` field (confirmed directly against the running API; the fuller `MyTimetable`
 * shape with a `slots` wrapper some other schoolhub frontends assume does not match this
 * endpoint's actual contract).
 */
export async function fetchMyTimetable(date: string): Promise<MyTimetableSlot[]> {
  const { data } = await apiClient.get<MyTimetableSlot[]>(endpoints.dashboard.myTimetable, {
    query: { date },
  });
  return data;
}

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
  // Both real fields on `StaffSerializer` (`apps/api/apps/staff_management/
  // serializers.py`'s `Meta.fields`), read-only there and set only by the `:exit`
  // colon-action — never a plain PATCH. Included here (optional, since a listing
  // response for an active staff member won't have them set) so `exitStaff`'s own
  // return value carries them without a second, exit-only response type; the
  // directory table itself has no reason to read either field yet.
  exit_date?: string | null;
  exit_reason?: string | null;
}

/** `/staff`'s own hard page-size ceiling (api-architecture.md §2.4). */
const MAX_PAGE_SIZE = 100;

/**
 * Every staff member, up to one page. `/staff` is page-number paginated, not cursor —
 * `collectPages` only walks cursors, so it silently returned page one only; this reads
 * one large page directly instead. A school with more than 100 staff loses the rest for
 * now, same trade-off `PENDING_PREVIEW_SIZE`-style caps make elsewhere in this app.
 */
export async function fetchStaffDirectory(): Promise<StaffDirectoryRecord[]> {
  const { items } = await fetchPage<StaffDirectoryRecord>(apiClient, endpoints.dashboard.staff, {
    query: { page_size: MAX_PAGE_SIZE },
  });
  return items;
}

export interface StaffDirectoryQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  ordering?: string;
  employmentStatus?: string;
}

/**
 * One page of the staff directory, server-paginated/sorted/searched — the `/staff`
 * page's own fetch, distinct from `fetchStaffDirectory`'s fixed one-page preview (used
 * by the dashboard-home Teams widget, which never changes page/search/sort). `search`
 * and `ordering` are passed straight through to `/staff`'s own DRF `SearchFilter`/
 * `OrderingFilter` — confirmed fields, `apps/api/apps/staff_management/views.py`'s
 * `search_fields`/`ordering_fields` — never invented client-side. `employmentStatus`
 * is sent as `employment_status`, `/staff`'s real exact-match filter
 * (`apps/api/apps/staff_management/filters.py`'s `StaffFilterSet.Meta.fields`) — a
 * single value, not multi-select, so it's a plain `string`, not an array.
 */
export async function fetchStaffPage(
  query: StaffDirectoryQuery = {},
): Promise<Page<StaffDirectoryRecord>> {
  const { page, pageSize, search, ordering, employmentStatus } = query;
  return fetchPage<StaffDirectoryRecord>(apiClient, endpoints.dashboard.staff, {
    query: {
      ...(page ? { page } : {}),
      ...(pageSize ? { page_size: pageSize } : {}),
      ...(search ? { search } : {}),
      ...(ordering ? { ordering } : {}),
      ...(employmentStatus ? { employment_status: employmentStatus } : {}),
    },
  });
}

/**
 * Real headcount for one `staff_type`, for the `/staff` toolbar's "Teaching Staff"
 * stat — same single-`page_size: 1`-request, read-`total_count` pattern as
 * `fetchTotal`, but scoped to one `staff_type` rather than an unfiltered endpoint, so
 * it's kept as its own small function instead of forcing `fetchTotal` to grow an
 * extra-query-param parameter for its one caller. `null` means the endpoint didn't
 * report a total — never a fabricated zero.
 */
export async function fetchStaffTypeCount(
  staffType: "teaching" | "non_teaching",
): Promise<number | null> {
  const page = await fetchPage<{ id: string }>(apiClient, endpoints.dashboard.staff, {
    query: { staff_type: staffType, page_size: 1 },
  });
  const pagination = page.pagination;
  if (!pagination || !("total_count" in pagination)) return null;
  return pagination.total_count ?? null;
}

/**
 * Reference-data option lists for the staff form's dropdowns (campus/department/
 * designation). Each display field below is the real one — confirmed against the
 * actual serializers, not assumed to be `name`:
 * `CampusSerializer`/`DepartmentSerializer` (`apps/api/apps/school_organization/
 * serializers.py`) and `DesignationSerializer` (`apps/api/apps/staff_management/
 * serializers.py`) all expose their display field as `name`.
 *
 * All three are `ModelViewSet`s with page-number pagination, same as `/staff` — capped
 * at `MAX_PAGE_SIZE` rather than drained with `collectPages` (which only walks cursor
 * pagination) for the same reason `fetchStaffDirectory` is: one school's org structure
 * (its campuses, departments, designations) is always small enough to fit in one bounded
 * read, never worth a second request.
 */
export interface CampusOption {
  id: string;
  name: string;
}

/** Every campus, as selectable options — not just the `fetchDashboardOverview` count. */
export async function fetchCampuses(): Promise<CampusOption[]> {
  const { items } = await fetchPage<CampusOption>(apiClient, endpoints.dashboard.campuses, {
    query: { page_size: MAX_PAGE_SIZE },
  });
  return items;
}

export interface DepartmentOption {
  id: string;
  name: string;
}

export async function fetchDepartments(): Promise<DepartmentOption[]> {
  const { items } = await fetchPage<DepartmentOption>(apiClient, endpoints.dashboard.departments, {
    query: { page_size: MAX_PAGE_SIZE },
  });
  return items;
}

export interface DesignationOption {
  id: string;
  name: string;
}

export async function fetchDesignations(): Promise<DesignationOption[]> {
  const { items } = await fetchPage<DesignationOption>(
    apiClient,
    endpoints.dashboard.designations,
    { query: { page_size: MAX_PAGE_SIZE } },
  );
  return items;
}

/**
 * The staff form's own input shape — camelCase, as every other input type in this
 * codebase is — mapped to the real snake_case body `create_staff`
 * (`apps/api/apps/staff_management/services.py:274`) expects. `employee_number` is
 * deliberately absent: it's server-generated on create, never sent by a caller.
 *
 * No client-side Zod/required-field validation happens in this file — that belongs to
 * the form dialog (`react-hook-form` + `zod`, mirroring `features/auth/login-form.tsx`'s
 * split of instant client feedback backed by the API remaining the sole authority).
 * This function is a thin, honest wrapper around the real endpoint, nothing more.
 */
export interface CreateStaffInput {
  campusId: string;
  joiningDate: string; // ISO date, YYYY-MM-DD
  firstName: string;
  lastName: string;
  staffType: "teaching" | "non_teaching";
  phone: string;
  departmentId?: string;
  designationId?: string;
  reportsToStaffId?: string;
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

/** `POST /staff` — creates one staff record. */
export async function createStaff(input: CreateStaffInput): Promise<StaffDirectoryRecord> {
  const { data } = await apiClient.post<StaffDirectoryRecord>(endpoints.dashboard.staff, {
    campus_id: input.campusId,
    joining_date: input.joiningDate,
    first_name: input.firstName,
    last_name: input.lastName,
    staff_type: input.staffType,
    phone: input.phone,
    ...(input.departmentId ? { department_id: input.departmentId } : {}),
    ...(input.designationId ? { designation_id: input.designationId } : {}),
    ...(input.reportsToStaffId ? { reports_to_staff_id: input.reportsToStaffId } : {}),
    ...(input.userId ? { user_id: input.userId } : {}),
    ...(input.photoFileId ? { photo_file_id: input.photoFileId } : {}),
    ...(input.gender ? { gender: input.gender } : {}),
    ...(input.dateOfBirth ? { date_of_birth: input.dateOfBirth } : {}),
    ...(input.employmentType ? { employment_type: input.employmentType } : {}),
    ...(input.email ? { email: input.email } : {}),
    ...(input.nationalId ? { national_id: input.nationalId } : {}),
    ...(input.publicBio ? { public_bio: input.publicBio } : {}),
    ...(input.address ? { address: input.address } : {}),
  });
  return data;
}

/**
 * Same field set as `CreateStaffInput`, all optional — a `PATCH` only sends what
 * changed. Unlike `createStaff`'s `!input.xId` (omit a falsy value), every optional key
 * here is sent whenever it's not literally `undefined`, so a caller can explicitly clear
 * a field with `""`/`null` on an edit rather than that clear being silently dropped.
 */
export type UpdateStaffInput = Partial<CreateStaffInput>;

/** `PATCH /staff/{id}` — a plain generic `ModelViewSet` partial update. */
export async function updateStaff(
  id: string,
  input: UpdateStaffInput,
): Promise<StaffDirectoryRecord> {
  const { data } = await apiClient.patch<StaffDirectoryRecord>(
    endpoints.dashboard.staffDetail(id),
    {
      ...(input.campusId ? { campus_id: input.campusId } : {}),
      ...(input.joiningDate ? { joining_date: input.joiningDate } : {}),
      ...(input.firstName ? { first_name: input.firstName } : {}),
      ...(input.lastName ? { last_name: input.lastName } : {}),
      ...(input.staffType ? { staff_type: input.staffType } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.departmentId !== undefined ? { department_id: input.departmentId } : {}),
      ...(input.designationId !== undefined ? { designation_id: input.designationId } : {}),
      ...(input.reportsToStaffId !== undefined
        ? { reports_to_staff_id: input.reportsToStaffId }
        : {}),
      ...(input.userId !== undefined ? { user_id: input.userId } : {}),
      ...(input.photoFileId !== undefined ? { photo_file_id: input.photoFileId } : {}),
      ...(input.gender !== undefined ? { gender: input.gender } : {}),
      ...(input.dateOfBirth !== undefined ? { date_of_birth: input.dateOfBirth } : {}),
      ...(input.employmentType !== undefined ? { employment_type: input.employmentType } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.nationalId !== undefined ? { national_id: input.nationalId } : {}),
      ...(input.publicBio !== undefined ? { public_bio: input.publicBio } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
    },
  );
  return data;
}

/**
 * `POST /staff/{id}:exit` — a colon-action, not a nested `/staff/{id}/exit` path (the
 * real registered route, `apps/api/apps/staff_management/urls.py:45`). Body validated
 * server-side by `ExitRequestSerializer`
 * (`apps/api/apps/staff_management/serializers.py:253`); `exitType` is left out of the
 * body entirely when omitted (not sent as `undefined`/`""`) so the server's own default
 * of `"resigned"` actually applies.
 */
export interface ExitStaffInput {
  exitDate: string; // ISO date, YYYY-MM-DD
  exitReason: string;
  exitType?: "resigned" | "retired" | "terminated";
}

export async function exitStaff(id: string, input: ExitStaffInput): Promise<StaffDirectoryRecord> {
  const { data } = await apiClient.post<StaffDirectoryRecord>(endpoints.dashboard.staffExit(id), {
    exit_date: input.exitDate,
    exit_reason: input.exitReason,
    ...(input.exitType ? { exit_type: input.exitType } : {}),
  });
  return data;
}

/**
 * The full field set the edit form needs to pre-fill — `StaffDirectoryRecord` above only
 * carries what the directory table displays. This is the real, complete
 * `StaffSerializer.Meta.fields` tuple (`apps/api/apps/staff_management/serializers.py`),
 * minus `exit_date`/`exit_reason` (real fields, but read-only outside the separate
 * `:exit` action — no edit-form use for them here) and minus `custom_fields`/
 * `created_at`/`updated_at` (out of scope for this form; `custom_fields` is out of scope
 * for the whole plan).
 */
export interface StaffDetailRecord {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  gender: string | null;
  date_of_birth: string | null;
  photo_file_id: string | null;
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

/** `GET /staff/{id}` — the one full staff record, for the edit form's pre-fill. */
export async function fetchStaffById(id: string): Promise<StaffDetailRecord> {
  const { data } = await apiClient.get<StaffDetailRecord>(endpoints.dashboard.staffDetail(id));
  return data;
}
