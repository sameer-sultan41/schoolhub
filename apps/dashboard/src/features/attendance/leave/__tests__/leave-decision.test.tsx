import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";

import {
  ALREADY_APPROVED,
  approvalStep,
  DECIDED_EARLIER,
  escalatedRecord,
  LEAVE_ID,
  leavePage,
  leaveRecord,
  NEEDS_WIDER_SCOPE,
  OWN_REQUEST,
} from "@/services/modules/leave-requests/__tests__/leave-requests-fixtures";
import { LEAVE_QUERY_MODULE } from "@/services/modules/leave-requests/leave-requests-constant";
import { STUDENT_ATTENDANCE_QUERY_MODULE } from "@/services/modules/student-attendance/student-attendance-constant";

import {
  amnaPending,
  asUser,
  bilalOwn,
  decide,
  fetchPage,
  MY_USER_ID,
  renderLeave,
  renderLeaveWithClient,
  stubLeaveServices,
} from "./leave-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ leaveServicesMock: () => unknown }>("./leave-services-mock")
    .leaveServicesMock(),
);

const APPROVE_AMNA = "Approve the leave request for Amna Raza";
const REJECT_AMNA = "Reject the leave request for Amna Raza";
const ANY_DECISION_BUTTON = /^(Approve|Reject) the leave request/;

function refusal(status: number, code: string, message: string, field?: string) {
  return new ApiError({
    code,
    message,
    status,
    url: `/leave-requests/${LEAVE_ID}:approve`,
    details: field ? [{ field, issue: message }] : [],
  });
}

/** A twelve-day request still at level 1 of its two-level chain. */
const twoLevelAtOne = leaveRecord({
  days_count: "12.0",
  approvals: [
    approvalStep(),
    approvalStep({ id: "77777777-aaaa-4bbb-8ccc-000000000022", level: 2 }),
  ],
});

/** Renders the queue, spying on the cache's `invalidateQueries` from here on. */
async function renderSpyingOnCache() {
  const { user, queryClient } = await renderLeaveWithClient();
  return { user, invalidate: jest.spyOn(queryClient, "invalidateQueries") };
}

/** The query modules the spy was asked to invalidate, in call order. */
function invalidated(invalidate: jest.SpyInstance) {
  return invalidate.mock.calls.map(([filters]) => (filters as { queryKey: string[] }).queryKey[0]);
}

describe("LeaveTable decisions", () => {
  beforeEach(() => {
    stubLeaveServices();
    asUser("attendance.leave-request.approve");
  });

  it("offers Approve and Reject on a pending request that is open to the viewer", async () => {
    await renderLeave();

    await screen.findByText("Amna Raza");
    expect(screen.getByRole("button", { name: APPROVE_AMNA })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: REJECT_AMNA })).toBeInTheDocument();
    // Noor waits at level 2 and the viewer decided no level of it.
    expect(
      screen.getByRole("button", { name: "Approve the leave request for Noor Qureshi" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reject the leave request for Noor Qureshi" }),
    ).toBeInTheDocument();
  });

  it("offers nothing on the viewer's own request", async () => {
    await renderLeave();

    await screen.findByText("Bilal Khan");
    expect(
      screen.queryByRole("button", { name: "Approve the leave request for Bilal Khan" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject the leave request for Bilal Khan" }),
    ).not.toBeInTheDocument();
  });

  it("offers nothing at level 2 to the viewer who decided level 1", async () => {
    await renderLeave();

    await screen.findByText("Sara Ali");
    expect(
      screen.queryByRole("button", { name: "Approve the leave request for Sara Ali" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject the leave request for Sara Ali" }),
    ).not.toBeInTheDocument();
  });

  it("offers nothing on a request that is already decided", async () => {
    await renderLeave();

    await screen.findByText("Usman Siddiqui");
    expect(
      screen.queryByRole("button", { name: "Approve the leave request for Usman Siddiqui" }),
    ).not.toBeInTheDocument();
  });

  it("offers nothing on a page of only the viewer's own and already-decided requests", async () => {
    fetchPage.mockResolvedValue(leavePage([bilalOwn, escalatedRecord(MY_USER_ID)]));
    await renderLeave();

    await screen.findByText("Bilal Khan");
    expect(screen.queryByRole("button", { name: ANY_DECISION_BUTTON })).toBeNull();
  });

  it("offers nothing without attendance.leave-request.approve", async () => {
    asUser();
    await renderLeave();

    await screen.findByText("Amna Raza");
    expect(screen.queryByRole("button", { name: ANY_DECISION_BUTTON })).toBeNull();
  });

  it("approves with a note, says how many days were marked, then reloads the queue", async () => {
    decide.mockResolvedValue({ request: leaveRecord({ status: "approved" }), autoMarkedDays: 3 });
    const user = await renderLeave();
    await user.click(await screen.findByRole("button", { name: APPROVE_AMNA }));

    const dialog = await screen.findByRole("dialog", { name: "Approve leave request" });
    expect(
      within(dialog).getByText(
        "Amna Raza, October 26th, 2026 to October 28th, 2026. You are deciding level 1 of 1.",
      ),
    ).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Note (optional)"), "Seen the medical note");
    const reads = fetchPage.mock.calls.length;
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(decide).toHaveBeenCalledWith(LEAVE_ID, "approve", "Seen the medical note");
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(toast.success).toHaveBeenCalledWith("Leave approved. 3 days marked as on leave.");
    await waitFor(() => {
      expect(fetchPage.mock.calls.length).toBeGreaterThan(reads);
    });
  });

  it.each([
    { autoMarkedDays: 1, message: "Leave approved. 1 day marked as on leave." },
    {
      autoMarkedDays: 0,
      message: "Leave approved. No attendance days were marked.",
    },
  ])("toasts the marked days when the server counted $autoMarkedDays", async (outcome) => {
    decide.mockResolvedValue({
      request: leaveRecord({ status: "approved" }),
      autoMarkedDays: outcome.autoMarkedDays,
    });
    const user = await renderLeave();
    await user.click(await screen.findByRole("button", { name: APPROVE_AMNA }));
    const dialog = await screen.findByRole("dialog", { name: "Approve leave request" });

    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(outcome.message);
    });
  });

  it("tells a level 1 approver the request now waits for level 2, with no day marked", async () => {
    fetchPage.mockResolvedValue(leavePage([twoLevelAtOne]));
    decide.mockResolvedValue({ request: escalatedRecord(MY_USER_ID), autoMarkedDays: 0 });
    const user = await renderLeave();
    await user.click(await screen.findByRole("button", { name: APPROVE_AMNA }));

    const dialog = await screen.findByRole("dialog", { name: "Approve leave request" });
    expect(within(dialog).getByText(/You are deciding level 1 of 2\./)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Approved. The request now waits for level 2.");
    });
  });

  it("rejects without a note", async () => {
    decide.mockResolvedValue({
      request: leaveRecord({ status: "rejected" }),
      autoMarkedDays: 0,
    });
    const user = await renderLeave();
    await user.click(await screen.findByRole("button", { name: REJECT_AMNA }));

    const dialog = await screen.findByRole("dialog", { name: "Reject leave request" });
    await user.click(within(dialog).getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(decide).toHaveBeenCalledWith(LEAVE_ID, "reject", "");
    });
    expect(toast.success).toHaveBeenCalledWith("Leave request rejected.");
  });

  it("decides nothing when the dialog is cancelled", async () => {
    const user = await renderLeave();
    await user.click(await screen.findByRole("button", { name: APPROVE_AMNA }));

    const dialog = await screen.findByRole("dialog", { name: "Approve leave request" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(decide).not.toHaveBeenCalled();
  });

  it.each([
    ["the approver is the submitter", OWN_REQUEST],
    ["the approver decided an earlier level", DECIDED_EARLIER],
    ["level 2 needs a campus or school-wide scope", NEEDS_WIDER_SCOPE],
  ])("keeps the dialog open with the server's 422 inline when %s", async (_case, message) => {
    decide.mockRejectedValue(refusal(422, "domain_rule_violation", message, "approver_id"));
    const user = await renderLeave();
    await user.click(await screen.findByRole("button", { name: APPROVE_AMNA }));

    const dialog = await screen.findByRole("dialog", { name: "Approve leave request" });
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(toast.success).not.toHaveBeenCalled();
    // The generic code text would have replaced the server's reason.
    expect(screen.queryByText("That action isn't allowed right now.")).not.toBeInTheDocument();
  });

  it("on a 409 shows the server's sentence, reloads the row and holds the decision", async () => {
    fetchPage
      .mockResolvedValueOnce(leavePage([amnaPending, bilalOwn]))
      .mockResolvedValue(leavePage([bilalOwn]));
    decide.mockRejectedValue(refusal(409, "conflict", ALREADY_APPROVED));
    const user = await renderLeave();
    await user.click(await screen.findByRole("button", { name: APPROVE_AMNA }));

    const dialog = await screen.findByRole("dialog", { name: "Approve leave request" });
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
    decide.mockResolvedValue({ request: leaveRecord({ status: "approved" }), autoMarkedDays: 3 });
    const { user, invalidate } = await renderSpyingOnCache();
    await user.click(await screen.findByRole("button", { name: APPROVE_AMNA }));
    const dialog = await screen.findByRole("dialog", { name: "Approve leave request" });

    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(invalidated(invalidate)).toEqual([
        LEAVE_QUERY_MODULE,
        STUDENT_ATTENDANCE_QUERY_MODULE,
      ]);
    });
  });

  it("refreshes the queue after a rejection, but not the attendance records", async () => {
    decide.mockResolvedValue({ request: leaveRecord({ status: "rejected" }), autoMarkedDays: 0 });
    const { user, invalidate } = await renderSpyingOnCache();
    await user.click(await screen.findByRole("button", { name: REJECT_AMNA }));
    const dialog = await screen.findByRole("dialog", { name: "Reject leave request" });

    await user.click(within(dialog).getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(invalidated(invalidate)).toEqual([LEAVE_QUERY_MODULE]);
    });
  });

  it("refreshes nothing after a 422, and only the queue after a 409", async () => {
    decide.mockRejectedValueOnce(
      refusal(422, "domain_rule_violation", DECIDED_EARLIER, "approver_id"),
    );
    const { user, invalidate } = await renderSpyingOnCache();
    await user.click(await screen.findByRole("button", { name: APPROVE_AMNA }));
    const dialog = await screen.findByRole("dialog", { name: "Approve leave request" });

    await user.click(within(dialog).getByRole("button", { name: "Approve" }));
    await within(dialog).findByText(DECIDED_EARLIER);

    expect(invalidate).not.toHaveBeenCalled();

    decide.mockRejectedValueOnce(refusal(409, "conflict", ALREADY_APPROVED));
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));
    await within(dialog).findByText(ALREADY_APPROVED);

    expect(invalidated(invalidate)).toEqual([LEAVE_QUERY_MODULE]);
  });
});
