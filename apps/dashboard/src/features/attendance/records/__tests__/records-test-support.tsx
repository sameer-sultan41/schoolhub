import type { PermissionKey } from "@schoolhub/types";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import {
  attendancePage,
  SECTION_ID,
} from "@/services/modules/student-attendance/__tests__/student-attendance-fixtures";
import { amna, bilal, CAMPUS_ID, CLASS_ID, sara } from "@/test-fixtures/attendance-records";
import { cursorPages, lastArg, mocked } from "@/test-fixtures/list-screen";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { RecordsTable } from "../records-table";

/** Shared setup for the Records tests; each file keeps its own `jest.mock` calls (hoisting). */

export { pick, rowOf, urlParam } from "@/test-fixtures/list-screen";

export const fetchPage = mocked(Services.studentAttendance.fetchAttendancePage);
export const requestCorrection = mocked(Services.attendanceCorrections.requestCorrection);

/** Signs in with `attendance.student-attendance.view` plus `keys`. */
export function asUser(...keys: PermissionKey[]) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(
    buildUser(["attendance.student-attendance.view", ...keys]),
  );
}

/** The `beforeEach` of every Records test: a view-only user, one page, one class and section. */
export function stubRecordsServices() {
  jest.clearAllMocks();
  setUrl("/attendance/records");
  asUser();
  fetchPage.mockResolvedValue(attendancePage([amna, bilal]));
  mocked(Services.schoolOrganization.fetchClasses).mockResolvedValue([
    { id: CLASS_ID, name: "Grade 5" },
  ]);
  mocked(Services.schoolOrganization.fetchSections).mockResolvedValue([
    { id: SECTION_ID, name: "A", campus_id: CAMPUS_ID },
  ]);
}

/** Two pages by cursor: Amna and Bilal, then Sara (`c2`). */
export function pageByCursor() {
  fetchPage.mockImplementation(
    cursorPages(
      attendancePage([amna, bilal], { next: "c2" }),
      attendancePage([sara], { previous: "c1" }),
    ),
  );
}

export async function renderRecords() {
  renderWithProviders(
    <>
      <UserLoaded />
      <RecordsTable />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

export const lastQuery = () => lastArg(fetchPage);
