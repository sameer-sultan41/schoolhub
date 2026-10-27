import type { PermissionKey } from "@schoolhub/types";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services, type StaffRegisterEntry } from "@/services";
import {
  OTHER_STAFF_ID,
  OTHER_STAFF_ROW_ID,
  staffAttendancePage,
  staffRecord,
  staffRegisterEntry,
  THIRD_STAFF_ID,
} from "@/services/modules/staff-attendance/__tests__/staff-attendance-fixtures";
import { mocked } from "@/test-fixtures/list-screen";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithClient, setUrl } from "@/test-utils";

import { StaffAttendanceScreen } from "../staff-attendance-screen";

/** Shared setup for the Staff tests; each file keeps its own `jest.mock` calls (hoisting). */

export { rowOf, urlParam } from "@/test-fixtures/list-screen";

export const fetchRegister = mocked(Services.staffAttendance.fetchStaffRegister);
export const fetchHistory = mocked(Services.staffAttendance.fetchStaffAttendancePage);
export const markStaff = mocked(Services.staffAttendance.markStaffAttendance);
export const checkOutStaff = mocked(Services.staffAttendance.checkOutStaff);

export const MARK: PermissionKey = "attendance.staff-attendance.mark";
export const VIEW: PermissionKey = "attendance.staff-attendance.view";
export const CORRECT: PermissionKey = "attendance.correction.create";

/** A date in the past, so the register can be marked. */
export const DATE = "2026-10-23";

/** Signs in with `attendance.staff-attendance.view` plus `keys`. */
export function asUser(...keys: PermissionKey[]) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(buildUser([VIEW, ...keys]));
}

/** Nadia unmarked; Omar present, in at 08:00 and not out; Sara late and locked. */
export const nadia = staffRegisterEntry();
export const omarRecord = staffRecord({
  id: OTHER_STAFF_ROW_ID,
  staff_id: OTHER_STAFF_ID,
  staff_name: "Omar Farooq",
  employee_number: "EMP-002",
});
export const omar = staffRegisterEntry({
  staff_id: OTHER_STAFF_ID,
  staff_name: "Omar Farooq",
  employee_number: "EMP-002",
  department_name: null,
  record: omarRecord,
});
export const sara = staffRegisterEntry({
  staff_id: THIRD_STAFF_ID,
  staff_name: "Sara Qureshi",
  employee_number: "EMP-003",
  record: staffRecord({
    id: "88888888-aaaa-4bbb-8ccc-000000000003",
    staff_id: THIRD_STAFF_ID,
    staff_name: "Sara Qureshi",
    employee_number: "EMP-003",
    status: "late",
    check_in_time: "08:40:00",
    late_minutes: 40,
    is_locked: true,
  }),
});

/** The `beforeEach` of every Staff test: a marker on the register for `DATE`, one history page. */
export function stubStaffServices(entries: StaffRegisterEntry[] = [nadia, omar, sara]) {
  jest.clearAllMocks();
  setUrl(`/attendance/staff?date=${DATE}`);
  asUser(MARK);
  fetchRegister.mockResolvedValue(entries);
  fetchHistory.mockResolvedValue(staffAttendancePage([]));
}

/** Renders the screen once the user has loaded; hands back the user-event and the client. */
export async function renderStaff() {
  const { queryClient } = renderWithClient(
    <>
      <UserLoaded />
      <StaffAttendanceScreen />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return { user: userEvent.setup(), queryClient };
}

/** Queries within the register row that shows `name`. */
export function staffRow(name: string) {
  const row = screen.getByText(name).closest("li");
  if (!row) throw new Error(`no register row for ${name}`);
  return within(row);
}
