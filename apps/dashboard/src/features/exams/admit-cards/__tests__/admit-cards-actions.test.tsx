import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";

import type { BackgroundJobRecord } from "@/services/modules/jobs/jobs-service";
import { admitCardPage } from "@/services/modules/admit-cards/__tests__/admit-cards-fixtures";
import { examRecord } from "@/services/modules/exams/__tests__/exams-fixtures";

import {
  asUser,
  fetchAdmitCardsPage,
  fetchJob,
  issueAdmitCards,
  revokeAdmitCard,
  rowOf,
  stubExamsServices,
} from "../../__tests__/exams-test-support";
import { asIssuer, CARD_VIEW, ISSUED, renderTab, REVOKED } from "./admit-cards-test-support";

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

// The server's typed counts, and the localised line each renders as.
const FIRST_RUN = { added: 2, existing: 0 };
const FIRST_RUN_TEXT = "2 admit cards added; none already existed.";
const TOP_UP = { added: 0, existing: 2 };
const TOP_UP_TEXT = "No new admit cards; 2 already existed.";

function renderJob(overrides: Partial<BackgroundJobRecord> = {}): BackgroundJobRecord {
  return {
    id: "job-1",
    job_type: "exams.admit-cards",
    status: "succeeded",
    progress: 100,
    result: { rendered: 2, failed: [], cards: 2 },
    error: null,
    ...overrides,
  };
}

function apiError(status: number, code: string, message: string, field?: string) {
  return new ApiError({
    code,
    message,
    status,
    url: "/admit-cards",
    details: field ? [{ field, issue: message }] : [],
  });
}

describe("Issue admit cards", () => {
  beforeEach(() => {
    stubExamsServices();
    asIssuer();
    fetchAdmitCardsPage.mockResolvedValue(admitCardPage([ISSUED]));
    fetchJob.mockResolvedValue(renderJob());
  });

  it("is hidden until the schedule is published", async () => {
    await renderTab(examRecord({ status: "draft" }));

    await screen.findByText(ISSUED.student_name);
    expect(screen.queryByRole("button", { name: "Issue admit cards" })).not.toBeInTheDocument();
  });

  it("is hidden without the issue key", async () => {
    asUser(CARD_VIEW);
    await renderTab();

    await screen.findByText(ISSUED.student_name);
    expect(screen.queryByRole("button", { name: "Issue admit cards" })).not.toBeInTheDocument();
  });

  it("issues with an Idempotency-Key, reports the server's counts and waits for the PDFs", async () => {
    issueAdmitCards.mockResolvedValue({ jobId: "job-1", ...FIRST_RUN });
    const user = await renderTab();
    await screen.findByText(ISSUED.student_name);
    const reads = fetchAdmitCardsPage.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Issue admit cards" }));

    expect(await screen.findByText(FIRST_RUN_TEXT)).toBeInTheDocument();
    expect(issueAdmitCards).toHaveBeenCalledWith(examRecord().id, expect.any(String));
    await waitFor(() => {
      expect(fetchJob).toHaveBeenCalledWith("job-1");
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("2 admit card PDFs are ready.");
    });
    expect(fetchAdmitCardsPage.mock.calls.length).toBeGreaterThan(reads);
  });

  it("re-issued after a revoke, reports the server's top-up counts and keeps the card revoked", async () => {
    fetchAdmitCardsPage.mockResolvedValue(admitCardPage([ISSUED, REVOKED]));
    issueAdmitCards
      .mockResolvedValueOnce({ jobId: "job-1", ...FIRST_RUN })
      .mockResolvedValueOnce({ jobId: "job-2", ...TOP_UP });
    fetchJob
      .mockResolvedValueOnce(renderJob())
      .mockResolvedValue(renderJob({ id: "job-2", result: { rendered: 0, failed: [], cards: 0 } }));
    const user = await renderTab();
    await screen.findByText(REVOKED.student_name);

    await user.click(screen.getByRole("button", { name: "Issue admit cards" }));
    await screen.findByText(FIRST_RUN_TEXT);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Issue admit cards" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "Issue admit cards" }));

    // The server's counts, not a tally made here: nothing added, two already there.
    expect(await screen.findByText(TOP_UP_TEXT)).toBeInTheDocument();
    // A second accepted run is a new intent, so it carries a new key.
    const [first, second] = issueAdmitCards.mock.calls;
    expect(second?.[1]).not.toBe(first?.[1]);
    const row = rowOf(REVOKED.student_name);
    expect(row.getByText("Revoked")).toBeInTheDocument();
    expect(row.queryByRole("button", { name: /Download/ })).not.toBeInTheDocument();
  });

  it("toasts the server's sentence when it refuses to issue", async () => {
    const refusal =
      "This exam's schedule has not been published, so an admit card would print dates that are still being edited. Publish the schedule first.";
    issueAdmitCards.mockRejectedValue(apiError(409, "conflict", refusal));
    const user = await renderTab();
    await screen.findByText(ISSUED.student_name);

    await user.click(screen.getByRole("button", { name: "Issue admit cards" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(refusal);
    });
    expect(fetchJob).not.toHaveBeenCalled();
  });

  it("says when rendering fails, in the job's own words", async () => {
    issueAdmitCards.mockResolvedValue({ jobId: "job-1", ...FIRST_RUN });
    fetchJob.mockResolvedValue(renderJob({ status: "failed", error: "Renderer unavailable." }));
    const user = await renderTab();
    await screen.findByText(ISSUED.student_name);

    await user.click(screen.getByRole("button", { name: "Issue admit cards" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Renderer unavailable.");
    });
  });
});

describe("Revoke", () => {
  beforeEach(() => {
    stubExamsServices();
    asIssuer();
    fetchAdmitCardsPage.mockResolvedValue(admitCardPage([ISSUED]));
  });

  async function openRevoke() {
    const user = await renderTab();
    await screen.findByText(ISSUED.student_name);
    await user.click(screen.getByRole("button", { name: "Revoke Ali Raza's admit card" }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke Ali Raza's admit card" });
    return { user, dialog };
  }

  it("needs a reason", async () => {
    const { user, dialog } = await openRevoke();

    await user.click(within(dialog).getByRole("button", { name: "Revoke card" }));

    expect(
      await within(dialog).findByText("Give a reason for revoking this card."),
    ).toBeInTheDocument();
    expect(revokeAdmitCard).not.toHaveBeenCalled();
  });

  it("revokes with the reason, then reloads the list", async () => {
    revokeAdmitCard.mockResolvedValue({ ...ISSUED, status: "revoked", revoked_reason: "Fees" });
    const { user, dialog } = await openRevoke();
    const reads = fetchAdmitCardsPage.mock.calls.length;

    await user.type(within(dialog).getByLabelText("Reason"), "Fees outstanding");
    await user.click(within(dialog).getByRole("button", { name: "Revoke card" }));

    await waitFor(() => {
      expect(revokeAdmitCard).toHaveBeenCalledWith(ISSUED.id, "Fees outstanding");
    });
    expect(toast.success).toHaveBeenCalledWith("Ali Raza's admit card revoked.");
    await waitFor(() => {
      expect(fetchAdmitCardsPage.mock.calls.length).toBeGreaterThan(reads);
    });
  });

  it("keeps the server's sentence when the card was revoked meanwhile", async () => {
    revokeAdmitCard.mockRejectedValue(
      apiError(409, "conflict", "This admit card is already revoked."),
    );
    const { user, dialog } = await openRevoke();

    await user.type(within(dialog).getByLabelText("Reason"), "Fees outstanding");
    await user.click(within(dialog).getByRole("button", { name: "Revoke card" }));

    expect(
      await within(dialog).findByText("This admit card is already revoked."),
    ).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
