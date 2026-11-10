import { screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";

import { examRecord } from "@/services/modules/exams/__tests__/exams-fixtures";
import {
  conflictRecord,
  sittingRecord,
} from "@/services/modules/exam-schedules/__tests__/exam-schedules-fixtures";

import {
  asUser,
  fetchConflicts,
  fetchSittings,
  publishSchedule,
  stubExamsServices,
} from "../../__tests__/exams-test-support";
import {
  apiError,
  asScheduler,
  HARD,
  renderTab,
  SCHEDULE_VIEW,
  SECOND,
  SOFT,
} from "./schedule-test-support";

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

async function openPublishDialog(user: Awaited<ReturnType<typeof renderTab>>) {
  await user.click(screen.getByRole("button", { name: "Publish schedule" }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Publish schedule" }));
  return dialog;
}

describe("Publish schedule", () => {
  beforeEach(() => {
    stubExamsServices();
    asUser(SCHEDULE_VIEW);
    fetchSittings.mockResolvedValue([sittingRecord(), SECOND]);
    asScheduler();
  });

  it("is held while a hard finding stands, with the count of them", async () => {
    fetchConflicts.mockResolvedValue([
      HARD,
      SOFT,
      conflictRecord({ type: "invigilator_double_booked" }),
    ]);

    await renderTab();

    expect(await screen.findByText("2 blocking clashes to resolve first")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish schedule" })).toBeDisabled();
  });

  it("counts a single blocking clash in the singular", async () => {
    fetchConflicts.mockResolvedValue([HARD]);

    await renderTab();

    expect(await screen.findByText("1 blocking clash to resolve first")).toBeInTheDocument();
  });

  it("is not held by a soft finding, which only warns", async () => {
    fetchConflicts.mockResolvedValue([SOFT]);

    await renderTab();

    await screen.findByText(SOFT.message);
    expect(screen.getByRole("button", { name: "Publish schedule" })).toBeEnabled();
    expect(screen.queryByText(/blocking clash/)).not.toBeInTheDocument();
  });

  it("is hidden on an exam past scheduled", async () => {
    await renderTab(examRecord({ status: "marks_entry" }));

    await screen.findByText("Mathematics");
    expect(screen.queryByRole("button", { name: "Publish schedule" })).not.toBeInTheDocument();
  });

  it("publishes after a confirm, then reloads the exam's reads", async () => {
    publishSchedule.mockResolvedValue({ status: "scheduled", conflicts: [] });
    const user = await renderTab();
    await screen.findByText("No clashes found.");
    const reads = fetchSittings.mock.calls.length;

    await openPublishDialog(user);

    await waitFor(() => {
      expect(publishSchedule).toHaveBeenCalledWith(examRecord().id);
    });
    await waitFor(() => {
      expect(fetchSittings.mock.calls.length).toBeGreaterThan(reads);
    });
    expect(toast.success).toHaveBeenCalledWith("Schedule published.");
  });

  it("shows the server's findings when a forced publish is refused, and holds the button after", async () => {
    const refusal = "1 clash(es) must be resolved before this schedule can be published.";
    publishSchedule.mockRejectedValue(
      apiError(422, "domain_rule_violation", refusal, { meta: { conflicts: [HARD, SOFT] } }),
    );
    const user = await renderTab();
    await screen.findByText("No clashes found.");
    expect(screen.getByRole("button", { name: "Publish schedule" })).toBeEnabled();

    const dialog = await openPublishDialog(user);

    expect(await within(dialog).findByText(refusal)).toBeInTheDocument();
    expect(await screen.findByText(HARD.message)).toBeInTheDocument();
    expect(screen.getByText(SOFT.message)).toBeInTheDocument();
    expect(screen.getByText("1 blocking clash to resolve first")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows the server's reason when there is nothing to publish", async () => {
    publishSchedule.mockRejectedValue(
      apiError(422, "domain_rule_violation", "This exam has no sittings scheduled yet.", {
        field: "exam_id",
      }),
    );
    const user = await renderTab();
    await screen.findByText("No clashes found.");

    const dialog = await openPublishDialog(user);

    expect(
      await within(dialog).findByText("This exam has no sittings scheduled yet."),
    ).toBeInTheDocument();
  });
});
