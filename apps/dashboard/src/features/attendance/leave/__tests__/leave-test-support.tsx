import type { PermissionKey } from "@schoolhub/types";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import {
  CASUAL_TYPE_ID,
  escalatedRecord,
  FIFTH_LEAVE_ID,
  FOURTH_LEAVE_ID,
  leavePage,
  leaveRecord,
  leaveType,
  OTHER_APPROVER_ID,
  OTHER_LEAVE_ID,
  SICK_TYPE_ID,
  STAFF_TYPE_ID,
  THIRD_LEAVE_ID,
} from "@/services/modules/leave-requests/__tests__/leave-requests-fixtures";
import { cursorPages, lastArg, mocked } from "@/test-fixtures/list-screen";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithClient, setUrl } from "@/test-utils";

import { LeaveTable } from "../leave-table";

/** Shared setup for the Leave tests; each file keeps its own `jest.mock` calls (hoisting). */

export { pick, rowOf, urlParam } from "@/test-fixtures/list-screen";

export const fetchPage = mocked(Services.leaveRequests.fetchLeavePage);
export const fetchTypes = mocked(Services.leaveRequests.fetchLeaveTypes);
export const decide = mocked(Services.leaveRequests.decideLeave);
export const fetchDownloadUrl = mocked(Services.jobs.fetchFileDownloadUrl);

/** The signed-in user's id, `buildUser`'s: the one whose own requests and levels are barred. */
export const MY_USER_ID = buildUser([]).id;

/** Amna's three-day sick leave, from a guardian: a one-step chain an approver can decide. */
export const amnaPending = leaveRecord();

/** Bilal's half day, submitted by the signed-in user: an approver cannot decide their own. */
export const bilalOwn = leaveRecord({
  id: OTHER_LEAVE_ID,
  student_name: "Bilal Khan",
  admission_number: "ADM-1043",
  section_name: null,
  submitted_by: MY_USER_ID,
  submitted_by_name: "Test User",
  leave_type_id: CASUAL_TYPE_ID,
  leave_type_name: "Family event",
  start_date: "2026-10-30",
  end_date: "2026-10-30",
  day_part: "first_half",
  days_count: "0.5",
});

/** Sara's twelve days: the signed-in user already approved level 1, so level 2 is not theirs. */
export const saraDecidedByMe = escalatedRecord(MY_USER_ID, {
  id: THIRD_LEAVE_ID,
  student_name: "Sara Ali",
  admission_number: "ADM-1044",
});

/** Noor's twelve days: someone else approved level 1, so level 2 waits for the viewer. */
export const noorAtLevelTwo = escalatedRecord(OTHER_APPROVER_ID, {
  id: FOURTH_LEAVE_ID,
  student_name: "Noor Qureshi",
  admission_number: "ADM-1045",
});

/** Usman's leave, already approved: nothing left to decide. */
export const usmanApproved = leaveRecord({
  id: FIFTH_LEAVE_ID,
  student_name: "Usman Siddiqui",
  admission_number: "ADM-1046",
  status: "approved",
});

/** Signs in with `attendance.leave-request.view` plus `keys`. */
export function asUser(...keys: PermissionKey[]) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(
    buildUser(["attendance.leave-request.view", ...keys]),
  );
}

/** The `beforeEach` of every Leave test: a viewer (no approve key), one page, three types. */
export function stubLeaveServices() {
  jest.clearAllMocks();
  setUrl("/attendance/leave");
  asUser();
  fetchPage.mockResolvedValue(
    leavePage([amnaPending, bilalOwn, saraDecidedByMe, noorAtLevelTwo, usmanApproved]),
  );
  fetchTypes.mockResolvedValue([
    leaveType({ id: SICK_TYPE_ID, name: "Sick leave", applies_to: "both" }),
    leaveType({ id: CASUAL_TYPE_ID, name: "Family event", applies_to: "student" }),
    leaveType({ id: STAFF_TYPE_ID, name: "Study leave", applies_to: "staff" }),
  ]);
}

/** Two pages by cursor: Amna and Bilal, then Sara (`c2`). */
export function pageByCursor() {
  fetchPage.mockImplementation(
    cursorPages(
      leavePage([amnaPending, bilalOwn], { next: "c2" }),
      leavePage([saraDecidedByMe], { previous: "c1" }),
    ),
  );
}

/** Renders the queue; hands back the user-event and the `QueryClient`, to spy on its cache. */
export async function renderLeaveWithClient() {
  const { queryClient } = renderWithClient(
    <>
      <UserLoaded />
      <LeaveTable />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return { user: userEvent.setup(), queryClient };
}

export async function renderLeave() {
  return (await renderLeaveWithClient()).user;
}

export const lastQuery = () => lastArg(fetchPage);
