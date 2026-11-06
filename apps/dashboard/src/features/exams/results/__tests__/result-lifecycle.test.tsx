import { screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";

import type { ExamStatus } from "@/services";
import {
  CURRENT_USER_ID,
  OTHER_USER_ID,
  resultPage,
  resultRecord,
} from "@/services/modules/exam-results/__tests__/exam-results-fixtures";
import { EXAM_ID, examRecord } from "@/services/modules/exams/__tests__/exams-fixtures";

import {
  approveResults,
  asUser,
  fetchJob,
  fetchResultsPage,
  processResults,
  publishResults,
  rowOf,
  sendResultsBack,
  stubExamsServices,
} from "../../__tests__/exams-test-support";
import {
  apiError,
  OUTSTANDING,
  OWN_RUN_REFUSAL,
  PENDING,
  processJob,
  renderTab,
  RESULT_VIEW,
  WITHHELD,
} from "./results-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ examsServicesMock: () => unknown }>("../../__tests__/exams-services-mock")
    .examsServicesMock(),
);

const CREATE = "exams.result.create";
const APPROVE = "exams.result.approve";
const PUBLISH = "exams.result.publish";

/** Every result read answers `results`; the bar's pending read answers its own. */
function stubResults(pending = PENDING, results = [PENDING, WITHHELD]) {
  fetchResultsPage.mockImplementation((query) =>
    Promise.resolve(
      resultPage(query.status === "pending_approval" && query.pageSize === 1 ? [pending] : results),
    ),
  );
}

const exam = (status: ExamStatus) => examRecord({ status });

/** Each exam status, the actions it offers a holder of every key, and those it doesn't. */
const ACTIONS_BY_STATUS: [ExamStatus, string[], string[]][] = [
  ["marks_entry", ["Process results"], ["Approve", "Send back", "Publish results"]],
  ["processing", ["Process results", "Approve", "Send back"], ["Publish results"]],
  ["approved", ["Send back", "Publish results"], ["Process results", "Approve"]],
  ["published", [], ["Process results", "Approve", "Send back", "Publish results"]],
];

describe("Process results", () => {
  beforeEach(() => {
    stubExamsServices(`/exams/${EXAM_ID}?tab=results`);
    asUser(RESULT_VIEW, CREATE);
    stubResults();
    fetchJob.mockResolvedValue(processJob());
  });

  it("queues processing with an Idempotency-Key, polls the job and reloads the results", async () => {
    processResults.mockResolvedValue({ jobId: "job-1" });
    const user = await renderTab(exam("marks_entry"));
    await screen.findByText(PENDING.student_name);
    const reads = fetchResultsPage.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Process results" }));

    await waitFor(() => {
      expect(processResults).toHaveBeenCalledWith(EXAM_ID, expect.any(String));
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("2 students' results are ready for approval.");
    });
    expect(fetchResultsPage.mock.calls.length).toBeGreaterThan(reads);
  });

  it("shows the server's outstanding-marks refusal with a way to the Marks tab", async () => {
    processResults.mockRejectedValue(apiError(409, "marks_outstanding", OUTSTANDING));
    const user = await renderTab(exam("marks_entry"));
    await screen.findByText(PENDING.student_name);

    await user.click(screen.getByRole("button", { name: "Process results" }));

    expect(await screen.findByText(OUTSTANDING)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Marks" })).toHaveAttribute(
      "href",
      `/exams/${EXAM_ID}?tab=marks`,
    );
    expect(fetchJob).not.toHaveBeenCalled();
  });

  it("shows another 409's sentence without the way to Marks", async () => {
    const approved =
      "This exam is approved. Results can only be reprocessed before approval — send them back for correction first.";
    processResults.mockRejectedValue(apiError(409, "conflict", approved));
    const user = await renderTab(exam("marks_entry"));
    await screen.findByText(PENDING.student_name);

    await user.click(screen.getByRole("button", { name: "Process results" }));

    expect(await screen.findByText(approved)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Go to Marks" })).not.toBeInTheDocument();
  });

  it("keeps a withheld result withheld after a re-process, with the recomputed figures", async () => {
    processResults.mockResolvedValue({ jobId: "job-1" });
    const user = await renderTab(exam("processing"));
    await screen.findByText("61.00%");
    // The re-process recomputed Sara's figures and kept her outcome withheld.
    const recomputed = { ...WITHHELD, percentage: "64.00", grade: "B" };
    stubResults(PENDING, [PENDING, recomputed]);

    await user.click(screen.getByRole("button", { name: "Process results" }));

    expect(await screen.findByText("64.00%")).toBeInTheDocument();
    const row = rowOf(WITHHELD.student_name);
    expect(row.getByText("Withheld")).toBeInTheDocument();
    expect(row.queryByText("61.00%")).not.toBeInTheDocument();
  });

  it("is not offered once the results are approved", async () => {
    await renderTab(exam("approved"));

    await screen.findByText(PENDING.student_name);
    expect(screen.queryByRole("button", { name: "Process results" })).not.toBeInTheDocument();
  });
});

describe("The lifecycle actions by status", () => {
  beforeEach(() => {
    stubExamsServices(`/exams/${EXAM_ID}?tab=results`);
    asUser(RESULT_VIEW, CREATE, APPROVE, PUBLISH);
    stubResults();
  });

  it.each(ACTIONS_BY_STATUS)("a %s exam offers %j and not %j", async (status, shown, hidden) => {
    await renderTab(exam(status));
    await screen.findByText(PENDING.student_name);

    for (const name of shown) {
      expect(await screen.findByRole("button", { name })).toBeInTheDocument();
    }
    for (const name of hidden) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("offers only what the viewer's keys allow", async () => {
    asUser(RESULT_VIEW, PUBLISH);
    await renderTab(exam("processing"));
    await screen.findByText(PENDING.student_name);

    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send back" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Process results" })).not.toBeInTheDocument();
  });
});

describe("Segregation at approval", () => {
  beforeEach(() => {
    stubExamsServices(`/exams/${EXAM_ID}?tab=results`);
    asUser(RESULT_VIEW, APPROVE);
  });

  it("holds Approve for the latest processor, with the reason", async () => {
    stubResults(resultRecord({ processed_by: CURRENT_USER_ID, processed_by_name: "Test User" }));
    await renderTab();

    const approve = await screen.findByRole("button", { name: "Approve" });
    await waitFor(() => {
      expect(approve).toHaveAccessibleDescription(
        "You processed these results, so someone else must approve them.",
      );
    });
    expect(approve).toBeDisabled();
  });

  it("re-reads the processor after a send-back: held for this user's run, enabled once someone else re-processes", async () => {
    stubResults(resultRecord({ processed_by: CURRENT_USER_ID, processed_by_name: "Test User" }));
    sendResultsBack.mockResolvedValue({ reopened: 2, reason: "Recheck maths" });
    approveResults.mockResolvedValue({ approved: 2 });
    const user = await renderTab();
    const approve = await screen.findByRole("button", { name: "Approve" });
    await waitFor(() => {
      expect(approve).toHaveAccessibleDescription(
        "You processed these results, so someone else must approve them.",
      );
    });
    expect(approve).toBeDisabled();

    // B sends back and C re-processes: every pending row now names C.
    stubResults(resultRecord({ processed_by: OTHER_USER_ID }));
    await user.click(screen.getByRole("button", { name: "Send back" }));
    const sendBack = await screen.findByRole("dialog", { name: "Send these results back?" });
    await user.type(within(sendBack).getByLabelText("Reason"), "Recheck maths");
    await user.click(within(sendBack).getByRole("button", { name: "Send back" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    });
    expect(screen.getByText("Processed by Hina Clerk")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Approve results" }));

    await waitFor(() => {
      expect(approveResults).toHaveBeenCalledWith(EXAM_ID);
    });
    expect(toast.success).toHaveBeenCalledWith("2 results approved.");
  });

  it("holds Approve again once this user's own re-process ends", async () => {
    asUser(RESULT_VIEW, APPROVE, "exams.result.create");
    stubResults(resultRecord({ processed_by: OTHER_USER_ID }));
    processResults.mockResolvedValue({ jobId: "job-1" });
    fetchJob.mockResolvedValue(processJob());
    const user = await renderTab();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    });

    stubResults(resultRecord({ processed_by: CURRENT_USER_ID, processed_by_name: "Test User" }));
    await user.click(screen.getByRole("button", { name: "Process results" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Approve" })).toHaveAccessibleDescription(
      "You processed these results, so someone else must approve them.",
    );
  });

  it("says when the pending results can't be read, and retries", async () => {
    fetchResultsPage.mockImplementation((query) =>
      query.pageSize === 1
        ? Promise.reject(apiError(503, "server_error", "Service unavailable."))
        : Promise.resolve(resultPage([PENDING])),
    );
    const user = await renderTab();

    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve" })).toHaveAccessibleDescription();

    stubResults(resultRecord({ processed_by: OTHER_USER_ID }));
    await user.click(retry);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    });
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("shows the server's 422 when a forced approval comes from the processor", async () => {
    // The page read a pending row by someone else; the server knows the latest run was this user's.
    stubResults(resultRecord({ processed_by: OTHER_USER_ID }));
    approveResults.mockRejectedValue(
      apiError(422, "domain_rule_violation", OWN_RUN_REFUSAL, "approved_by"),
    );
    const user = await renderTab();

    const approve = await screen.findByRole("button", { name: "Approve" });
    await waitFor(() => {
      expect(approve).toBeEnabled();
    });
    await user.click(approve);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Approve results" }));

    expect(await within(dialog).findByText(OWN_RUN_REFUSAL)).toBeInTheDocument();
  });

  it("holds Approve when nothing awaits approval", async () => {
    fetchResultsPage.mockResolvedValue(resultPage([]));
    await renderTab();

    const approve = await screen.findByRole("button", { name: "Approve" });
    await waitFor(() => {
      expect(approve).toHaveAccessibleDescription("No results are awaiting approval.");
    });
    expect(approve).toBeDisabled();
  });
});

describe("Send back and Publish", () => {
  beforeEach(() => {
    stubExamsServices(`/exams/${EXAM_ID}?tab=results`);
    asUser(RESULT_VIEW, APPROVE, PUBLISH);
    stubResults();
  });

  it("sends back with a reason and reports the server's count", async () => {
    sendResultsBack.mockResolvedValue({ reopened: 2, reason: "Recheck maths" });
    const user = await renderTab(exam("approved"));

    await user.click(await screen.findByRole("button", { name: "Send back" }));
    const dialog = await screen.findByRole("dialog", { name: "Send these results back?" });
    await user.type(within(dialog).getByLabelText("Reason"), "Recheck maths");
    await user.click(within(dialog).getByRole("button", { name: "Send back" }));

    await waitFor(() => {
      expect(sendResultsBack).toHaveBeenCalledWith(EXAM_ID, "Recheck maths");
    });
    expect(toast.success).toHaveBeenCalledWith("2 results sent back; marks entry is open again.");
  });

  it("publishes and reports the server's published and withheld counts", async () => {
    publishResults.mockResolvedValue({ published: 1, withheld: 1, published_ids: [PENDING.id] });
    const user = await renderTab(exam("approved"));

    await user.click(await screen.findByRole("button", { name: "Publish results" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Publish results" }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("1 result published; 1 withheld.");
    });
    expect(publishResults).toHaveBeenCalledWith(EXAM_ID);
  });
});
