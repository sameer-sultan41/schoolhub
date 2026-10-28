import type { PermissionKey } from "@schoolhub/types";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import {
  correctionPage,
  correctionRecord,
  OTHER_CORRECTION_ID,
  THIRD_CORRECTION_ID,
} from "@/services/modules/attendance-corrections/__tests__/attendance-corrections-fixtures";
import { cursorPages, lastArg, mocked } from "@/test-fixtures/list-screen";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithClient, setUrl } from "@/test-utils";

import { CorrectionsTable } from "../corrections-table";

/** Shared setup for the Corrections tests; each file keeps its own `jest.mock` calls (hoisting). */

export { pick, rowOf, urlParam } from "@/test-fixtures/list-screen";

export const fetchPage = mocked(Services.attendanceCorrections.fetchCorrectionPage);
export const decide = mocked(Services.attendanceCorrections.decideCorrection);

/** The signed-in user's id, `buildUser`'s: the one whose own requests may not be decided. */
export const MY_USER_ID = buildUser([]).id;

/** Amna's late arrival, asked for by someone else: the row an approver can decide. */
export const amnaPending = correctionRecord();

/** Bilal's check-out time, asked for by the signed-in user, in period 2. */
export const bilalOwn = correctionRecord({
  id: OTHER_CORRECTION_ID,
  student_name: "Bilal Khan",
  period_name: "Period 2",
  requested_by: MY_USER_ID,
  requested_by_name: "Test User",
  old_values: { check_out_time: "13:00:00" },
  new_values: { check_out_time: "12:30:00" },
});

/** Sara's absence, excused and already decided, with the reviewer's note. */
export const saraApproved = correctionRecord({
  id: THIRD_CORRECTION_ID,
  student_name: "Sara Ali",
  old_values: { status: "absent" },
  new_values: { status: "excused" },
  status: "approved",
  reviewed_by_name: "Zainab Qureshi",
  review_note: "Verified with the parent",
});

/** Signs in with `attendance.correction.create` plus `keys`. */
export function asUser(...keys: PermissionKey[]) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(
    buildUser(["attendance.correction.create", ...keys]),
  );
}

/** The `beforeEach` of every Corrections test: a requester (no approve key) and one page. */
export function stubCorrectionsServices() {
  jest.clearAllMocks();
  setUrl("/attendance/corrections");
  asUser();
  fetchPage.mockResolvedValue(correctionPage([amnaPending, bilalOwn, saraApproved]));
}

/** Two pages by cursor: Amna and Bilal, then Sara (`c2`). */
export function pageByCursor() {
  fetchPage.mockImplementation(
    cursorPages(
      correctionPage([amnaPending, bilalOwn], { next: "c2" }),
      correctionPage([saraApproved], { previous: "c1" }),
    ),
  );
}

/** Renders the queue; hands back the user-event and the `QueryClient`, to spy on its cache. */
export async function renderCorrectionsWithClient() {
  const { queryClient } = renderWithClient(
    <>
      <UserLoaded />
      <CorrectionsTable />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return { user: userEvent.setup(), queryClient };
}

export async function renderCorrections() {
  return (await renderCorrectionsWithClient()).user;
}

export const lastQuery = () => lastArg(fetchPage);
