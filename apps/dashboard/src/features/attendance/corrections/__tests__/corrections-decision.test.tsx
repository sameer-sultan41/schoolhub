import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";

import { CORRECTIONS_QUERY_MODULE } from "@/services/modules/attendance-corrections/attendance-corrections-constant";
import { STAFF_ATTENDANCE_QUERY_MODULE } from "@/services/modules/staff-attendance/staff-attendance-constant";
import { STUDENT_ATTENDANCE_QUERY_MODULE } from "@/services/modules/student-attendance/student-attendance-constant";

import {
  ALREADY_APPROVED,
  correctionPage,
  correctionRecord,
  CORRECTION_ID,
  OWN_REQUEST,
} from "@/services/modules/attendance-corrections/__tests__/attendance-corrections-fixtures";
import { STAFF_ROW_ID } from "@/services/modules/staff-attendance/__tests__/staff-attendance-fixtures";

import {
  amnaPending,
  asUser,
  bilalOwn,
  decide,
  fetchPage,
  MY_USER_ID,
  renderCorrections,
  renderCorrectionsWithClient,
  saraApproved,
  stubCorrectionsServices,
} from "./corrections-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ correctionsServicesMock: () => unknown }>("./corrections-services-mock")
    .correctionsServicesMock(),
);

const APPROVE_AMNA = "Approve the correction for Amna Raza";
const REJECT_AMNA = "Reject the correction for Amna Raza";

function refusal(status: number, code: string, message: string, field?: string) {
  return new ApiError({
    code,
    message,
    status,
    url: `/attendance-corrections/${CORRECTION_ID}:approve`,
    details: field ? [{ field, issue: message }] : [],
  });
}

/** Renders the queue, spying on the cache's `invalidateQueries` from here on. */
async function renderSpyingOnCache() {
  const { user, queryClient } = await renderCorrectionsWithClient();
  return { user, invalidate: jest.spyOn(queryClient, "invalidateQueries") };
}

/** The query modules the spy was asked to invalidate, in call order. */
function invalidated(invalidate: jest.SpyInstance) {
  return invalidate.mock.calls.map(([filters]) => (filters as { queryKey: string[] }).queryKey[0]);
}

describe("CorrectionsTable decisions", () => {
  beforeEach(() => {
    stubCorrectionsServices();
    asUser("attendance.correction.approve");
  });

  it("offers Approve and Reject on a pending request from someone else only", async () => {
    await renderCorrections();

    await screen.findByText("Amna Raza");
    expect(screen.getByRole("button", { name: APPROVE_AMNA })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: REJECT_AMNA })).toBeInTheDocument();
    // Bilal's request is the signed-in user's own: an approver cannot decide it.
    expect(
      screen.queryByRole("button", { name: "Approve the correction for Bilal Khan" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject the correction for Bilal Khan" }),
    ).not.toBeInTheDocument();
    // Sara's is already decided.
    expect(
      screen.queryByRole("button", { name: "Approve the correction for Sara Ali" }),
    ).not.toBeInTheDocument();
  });

  it("offers no decision on a page of only the approver's own requests", async () => {
    fetchPage.mockResolvedValue(correctionPage([bilalOwn]));
    await renderCorrections();

    await screen.findByText("Bilal Khan");
    expect(screen.queryByRole("button", { name: /^(Approve|Reject) the correction/ })).toBeNull();
  });

  it("offers no decision on a correction to the approver's own attendance", async () => {
    // Raised by someone else, but the staff member it is about is the signed-in user.
    const aboutMe = correctionRecord({
      subject_type: "staff",
      student_attendance_id: null,
      student_id: null,
      student_name: null,
      staff_attendance_id: STAFF_ROW_ID,
      staff_name: "Nadia Hussain",
      subject_user_id: MY_USER_ID,
    });
    fetchPage.mockResolvedValue(correctionPage([amnaPending, aboutMe]));
    await renderCorrections();

    await screen.findByText("Nadia Hussain");
    expect(screen.getByRole("button", { name: APPROVE_AMNA })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^(Approve|Reject) the correction for Nadia Hussain/ }),
    ).toBeNull();
  });

  it("offers no decision without attendance.correction.approve", async () => {
    asUser();
    await renderCorrections();

    await screen.findByText("Amna Raza");
    expect(screen.queryByRole("button", { name: /^(Approve|Reject) the correction/ })).toBeNull();
  });

  it("approves with a note, then reloads the queue", async () => {
    decide.mockResolvedValue(correctionRecord({ status: "approved" }));
    const user = await renderCorrections();
    await user.click(await screen.findByRole("button", { name: APPROVE_AMNA }));

    const dialog = await screen.findByRole("dialog", { name: "Approve correction" });
    await user.type(within(dialog).getByLabelText("Note (optional)"), "Checked the gate log");
    const reads = fetchPage.mock.calls.length;
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(decide).toHaveBeenCalledWith(CORRECTION_ID, "approve", "Checked the gate log");
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(toast.success).toHaveBeenCalledWith("Correction approved.");
    await waitFor(() => {
      expect(fetchPage.mock.calls.length).toBeGreaterThan(reads);
    });
  });

  it("rejects without a note", async () => {
    decide.mockResolvedValue(correctionRecord({ status: "rejected" }));
    const user = await renderCorrections();
    await user.click(await screen.findByRole("button", { name: REJECT_AMNA }));

    const dialog = await screen.findByRole("dialog", { name: "Reject correction" });
    await user.click(within(dialog).getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(decide).toHaveBeenCalledWith(CORRECTION_ID, "reject", "");
    });
    expect(toast.success).toHaveBeenCalledWith("Correction rejected.");
  });

  it("decides nothing when the dialog is cancelled", async () => {
    const user = await renderCorrections();
    await user.click(await screen.findByRole("button", { name: APPROVE_AMNA }));

    const dialog = await screen.findByRole("dialog", { name: "Approve correction" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(decide).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with the server's refusal inline", async () => {
    decide.mockRejectedValue(refusal(422, "domain_rule_violation", OWN_REQUEST, "reviewed_by"));
    const user = await renderCorrections();
    await user.click(await screen.findByRole("button", { name: APPROVE_AMNA }));

    const dialog = await screen.findByRole("dialog", { name: "Approve correction" });
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    expect(await within(dialog).findByText(OWN_REQUEST)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("on a 409 shows the server's sentence, reloads the row and holds the decision", async () => {
    fetchPage
      .mockResolvedValueOnce(correctionPage([amnaPending, bilalOwn, saraApproved]))
      .mockResolvedValue(correctionPage([bilalOwn, saraApproved]));
    decide.mockRejectedValue(refusal(409, "conflict", ALREADY_APPROVED));
    const user = await renderCorrections();
    await user.click(await screen.findByRole("button", { name: APPROVE_AMNA }));

    const dialog = await screen.findByRole("dialog", { name: "Approve correction" });
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    // The server's own sentence, not the generic conflict text.
    expect(await within(dialog).findByText(ALREADY_APPROVED)).toBeInTheDocument();
    expect(screen.queryByText(/conflicts with the current data/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Approve" })).toBeDisabled();
    // The queue reloaded: the row behind the dialog is gone from the pending list.
    await waitFor(() => {
      expect(screen.queryByText("Amna Raza")).not.toBeInTheDocument();
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("refreshes the queue and the attendance records after an approval", async () => {
    decide.mockResolvedValue(correctionRecord({ status: "approved" }));
    const { user, invalidate } = await renderSpyingOnCache();
    await user.click(await screen.findByRole("button", { name: APPROVE_AMNA }));
    const dialog = await screen.findByRole("dialog", { name: "Approve correction" });

    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(invalidated(invalidate)).toEqual([
        CORRECTIONS_QUERY_MODULE,
        STUDENT_ATTENDANCE_QUERY_MODULE,
      ]);
    });
  });

  it("names a staff correction, and its approval refreshes staff attendance", async () => {
    // A staff row's correction as the server sends it: the student fields null.
    const nadiaPending = correctionRecord({
      subject_type: "staff",
      student_attendance_id: null,
      student_id: null,
      student_name: null,
      staff_attendance_id: STAFF_ROW_ID,
      staff_name: "Nadia Hussain",
      employee_number: "EMP-001",
      old_values: { status: "late", check_in_time: "08:40:00", check_out_time: null },
      new_values: { check_in_time: "08:05" },
    });
    fetchPage.mockResolvedValue(correctionPage([nadiaPending]));
    decide.mockResolvedValue({ ...nadiaPending, status: "approved" });
    const { user, invalidate } = await renderSpyingOnCache();

    await user.click(
      await screen.findByRole("button", { name: "Approve the correction for Nadia Hussain" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Approve correction" });
    expect(within(dialog).getByText(/^Nadia Hussain,/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(invalidated(invalidate)).toEqual([
        CORRECTIONS_QUERY_MODULE,
        STAFF_ATTENDANCE_QUERY_MODULE,
      ]);
    });
  });

  it("refreshes the queue after a rejection, but not the attendance records", async () => {
    decide.mockResolvedValue(correctionRecord({ status: "rejected" }));
    const { user, invalidate } = await renderSpyingOnCache();
    await user.click(await screen.findByRole("button", { name: REJECT_AMNA }));
    const dialog = await screen.findByRole("dialog", { name: "Reject correction" });

    await user.click(within(dialog).getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(invalidated(invalidate)).toEqual([CORRECTIONS_QUERY_MODULE]);
    });
  });
});
