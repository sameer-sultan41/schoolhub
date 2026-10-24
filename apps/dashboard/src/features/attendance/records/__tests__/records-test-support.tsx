import type { PermissionKey } from "@schoolhub/types";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import {
  attendancePage,
  SECTION_ID,
} from "@/services/modules/student-attendance/__tests__/student-attendance-fixtures";
import { amna, bilal, CAMPUS_ID, CLASS_ID, sara } from "@/test-fixtures/attendance-records";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { RecordsTable } from "../records-table";

/** Shared setup for the Records tests; each file keeps its own `jest.mock` calls (hoisting). */

export const mocked = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as jest.MockedFunction<T>;
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
  fetchPage.mockImplementation((query) =>
    Promise.resolve(
      query.cursor === "c2"
        ? attendancePage([sara], { previous: "c1" })
        : attendancePage([amna, bilal], { next: "c2" }),
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

export const urlParam = (key: string) => new URLSearchParams(window.location.search).get(key);
export const lastQuery = () => fetchPage.mock.calls[fetchPage.mock.calls.length - 1]?.[0];

/** Queries within the table row that shows `name`. */
export function rowOf(name: string) {
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return within(row);
}

/** Opens the `combobox` select and picks `option`. */
export async function pick(
  user: ReturnType<typeof userEvent.setup>,
  combobox: string,
  option: string,
) {
  await user.click(screen.getByRole("combobox", { name: combobox }));
  await user.click(await screen.findByRole("option", { name: option }));
}
