import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toMarkStaffBody, toStaffAttendanceQueryParams } from "./staff-attendance-helper";
import type {
  MarkStaffAttendanceInput,
  StaffAttendancePageQuery,
  StaffAttendanceRecord,
  StaffRegisterEntry,
  StaffRegisterQuery,
} from "./staff-attendance-type";

/** Staff attendance's API calls (`/staff-attendance`), reached through
 * `Services.staffAttendance.*`. */

/** Every active staff member the caller may mark on `date`, each with that day's record. Not
 * paged: the API answers the tenant's (or one department's) staff whole. */
export async function fetchStaffRegister(query: StaffRegisterQuery): Promise<StaffRegisterEntry[]> {
  const { data } = await apiClient.get<StaffRegisterEntry[]>(endpoints.staffAttendance.register, {
    query: {
      date: query.date,
      ...(query.departmentId ? { department_id: query.departmentId } : {}),
    },
  });
  return data;
}

/** One cursor page of staff attendance records; the caller's scope decides whose. */
export async function fetchStaffAttendancePage(
  query: StaffAttendancePageQuery,
): Promise<Page<StaffAttendanceRecord>> {
  return fetchPage<StaffAttendanceRecord>(apiClient, endpoints.staffAttendance.list, {
    query: toStaffAttendanceQueryParams(query),
  });
}

/** Records one staff member's day: creates it, or replaces an unlocked one (a locked row is a
 * 409). Answers with the row as written, its minutes computed by the server. */
export async function markStaffAttendance(
  input: MarkStaffAttendanceInput,
): Promise<StaffAttendanceRecord> {
  const { data } = await apiClient.post<StaffAttendanceRecord>(
    endpoints.staffAttendance.list,
    toMarkStaffBody(input),
  );
  return data;
}

/** `:check-out` with the departure time (`HH:MM`); answers with the row as it now stands. */
export async function checkOutStaff(
  id: string,
  checkOutTime: string,
): Promise<StaffAttendanceRecord> {
  const { data } = await apiClient.post<StaffAttendanceRecord>(
    endpoints.staffAttendance.checkOut(id),
    { check_out_time: checkOutTime },
  );
  return data;
}
