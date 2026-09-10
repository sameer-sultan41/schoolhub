import { collectPages, fetchPage } from "@schoolhub/api-client";
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

async function fetchTotal(path: string): Promise<number | null> {
  const page = await fetchPage<CountableRecord>(apiClient, path, { query: { page_size: 1 } });
  const pagination = page.pagination;
  if (!pagination || !("total_count" in pagination)) return null;
  return pagination.total_count ?? null;
}

async function fetchCount(path: string): Promise<number> {
  const items = await collectPages<CountableRecord>(apiClient, path);
  return items.length;
}

export interface DashboardOverview {
  /** `null` when the endpoint didn't report a total — never a fabricated zero. */
  students: number | null;
  staff: number | null;
  classes: number;
  sections: number;
  subjects: number;
  campuses: number;
}

/** Headline counts shared by the School Snapshot and Reference Overview widgets. */
export async function fetchDashboardOverview(): Promise<DashboardOverview> {
  const [students, staff, classes, sections, subjects, campuses] = await Promise.all([
    fetchTotal(endpoints.dashboard.students),
    fetchTotal(endpoints.dashboard.staff),
    fetchCount(endpoints.dashboard.classes),
    fetchCount(endpoints.dashboard.sections),
    fetchCount(endpoints.dashboard.subjects),
    fetchCount(endpoints.dashboard.campuses),
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
  staff_type: "teaching" | "non_teaching";
  updated_at: string;
}

/** Every staff member — the staff-directory table drains this once. */
export async function fetchStaffDirectory(): Promise<StaffDirectoryRecord[]> {
  return collectPages<StaffDirectoryRecord>(apiClient, endpoints.dashboard.staff);
}
