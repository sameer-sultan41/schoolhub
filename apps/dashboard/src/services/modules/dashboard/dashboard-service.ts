import { fetchPage } from "@schoolhub/api-client";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";

/**
 * The dashboard home screen's API calls. Every widget reaches these through
 * `Services.dashboard.*` (see `@/services`) — never by importing `@schoolhub/api-client`
 * or `@/lib/auth`'s `apiClient` directly.
 *
 * The wire types below are hand-declared, minimal subsets of the real API records —
 * only the fields these widgets actually read. The staff domain's own fuller types
 * (`StaffDirectoryRecord`, `StaffDetailRecord`, etc.) live in
 * `services/modules/staff/staff-type.ts`, not here.
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

/** `/staff`/`/campuses`/`/departments`/`/designations`'s own hard page-size ceiling
 * (api-architecture.md §2.4). */
const MAX_PAGE_SIZE = 100;

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
 * pagination), same reasoning as `Services.staff.fetchStaffDirectory`'s own cap: one
 * school's org structure (its campuses, departments, designations) is always small
 * enough to fit in one bounded read, never worth a second request.
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
