import type { PermissionKey } from "@schoolhub/types";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services, type PromotionBatchDetail, type PromotionStatus } from "@/services";
import {
  apiError,
  BATCH_ID,
  NEXT_CLASS_ID,
  promotionBatchDetail,
  promotionDecision,
  studentUuid,
} from "@/services/modules/promotions/__tests__/promotions-fixtures";
import { CLASS_ID } from "@/test-fixtures/academics";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { PromotionBatchReview } from "../promotion-batch-review";

// The header's title reads the current path (for the menu's icon), which the navigation mock keeps.
jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    promotions: {
      fetchPromotionBatch: jest.fn(),
      transitionBatch: jest.fn(),
      executeBatch: jest.fn(),
      updateDecision: jest.fn(),
    },
    jobs: { fetchJob: jest.fn() },
    schoolOrganization: { fetchClasses: jest.fn(), fetchSections: jest.fn() },
  },
}));

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockFetchBatch = Services.promotions.fetchPromotionBatch as jest.MockedFunction<
  typeof Services.promotions.fetchPromotionBatch
>;
const mockTransition = Services.promotions.transitionBatch as jest.MockedFunction<
  typeof Services.promotions.transitionBatch
>;
const mockUpdate = Services.promotions.updateDecision as jest.MockedFunction<
  typeof Services.promotions.updateDecision
>;
const mockFetchClasses = Services.schoolOrganization.fetchClasses as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchClasses
>;
const mockFetchSections = Services.schoolOrganization.fetchSections as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchSections
>;

const ALL_KEYS: PermissionKey[] = [
  "academics.promotion.update",
  "academics.promotion.approve",
  "academics.promotion.execute",
];

/** Each status and the label its badge carries. */
const STATUS_LABELS: [PromotionStatus, string][] = [
  ["draft", "Draft"],
  ["pending_approval", "Pending approval"],
  ["approved", "Approved"],
  ["executed", "Executed"],
  ["reverted", "Reverted"],
];

const ayesha = promotionDecision({ student_name: "Ayesha Khan" });
const bilal = promotionDecision({
  student_id: studentUuid(2),
  student_name: "Bilal Ahmed",
  admission_number: "ADM-0002",
});

function batchIn(status: PromotionStatus) {
  return promotionBatchDetail({ status, decisions: [ayesha] });
}

function renderReview() {
  renderWithProviders(<PromotionBatchReview batchId={BATCH_ID} />);
  return userEvent.setup();
}

describe("PromotionBatchReview", () => {
  beforeEach(() => {
    setUrl(`/academics/promotions/${BATCH_ID}`);
    mockFetchCurrentUser.mockReset().mockResolvedValue(buildUser(ALL_KEYS));
    mockFetchBatch.mockReset().mockResolvedValue(batchIn("draft"));
    mockTransition.mockReset().mockResolvedValue({ updated: 1 });
    mockUpdate.mockReset().mockResolvedValue(ayesha);
    mockFetchClasses.mockReset().mockResolvedValue([
      { id: CLASS_ID, name: "Grade 1" },
      { id: NEXT_CLASS_ID, name: "Grade 2" },
    ]);
    mockFetchSections.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the batch", () => {
    it("shows a loading state until the batch arrives", async () => {
      mockFetchBatch.mockReturnValue(new Promise<PromotionBatchDetail>(() => undefined));
      renderReview();

      expect(screen.getByRole("status")).toHaveTextContent("Loading");
      await waitFor(() => {
        expect(mockFetchBatch).toHaveBeenCalledWith(BATCH_ID);
      });
      expect(screen.queryByRole("heading", { name: "Promotion batch" })).not.toBeInTheDocument();
    });

    it("heads the page with the class, the sessions, the count and the status", async () => {
      mockFetchBatch.mockResolvedValue(promotionBatchDetail({ students: 24, decisions: [ayesha] }));
      renderReview();

      const title = await screen.findByRole("heading", { level: 1, name: "Promotion batch" });
      expect(title).toBeInTheDocument();
      expect(screen.getByText("Grade 1")).toBeInTheDocument();
      expect(screen.getByText("2026-27 → 2027-28")).toBeInTheDocument();
      expect(screen.getByText("24 students")).toBeInTheDocument();
      expect(screen.getByText("Draft")).toBeInTheDocument();
    });

    it("links back to every batch", async () => {
      renderReview();

      const back = await screen.findByRole("link", { name: "All batches" });
      expect(back).toHaveAttribute("href", "/academics/promotions");
    });

    it.each(STATUS_LABELS)("says %s once and only once", async (status, label) => {
      const batch = promotionBatchDetail({ status, decisions: [ayesha, bilal] });
      mockFetchBatch.mockResolvedValue(batch);
      renderReview();

      await screen.findByRole("row", { name: /Bilal Ahmed/ });

      // The live page object matches the label by exact text: a second one fails its strict mode.
      expect(screen.getAllByText(label, { exact: true })).toHaveLength(1);
    });

    it("shows what the viewer can do and every student's decision", async () => {
      renderReview();

      expect(await screen.findByRole("button", { name: "Submit for approval" })).toBeEnabled();
      expect(screen.getByRole("row", { name: /Ayesha Khan/ })).toBeInTheDocument();
    });
  });

  describe("when there is no batch to show", () => {
    it("says a 404 is not found, with the way back to the list", async () => {
      mockFetchBatch.mockRejectedValue(apiError(404, "not_found"));
      renderReview();

      expect(await screen.findByText("Promotion batch not found")).toBeInTheDocument();
      const back = screen.getByRole("link", { name: "All batches" });
      expect(back).toHaveAttribute("href", "/academics/promotions");
      expect(screen.queryByRole("heading", { name: "Promotion batch" })).not.toBeInTheDocument();
    });

    it("shows any other failure with a retry, which loads the batch", async () => {
      mockFetchBatch.mockRejectedValueOnce(apiError(500, "server_error"));
      const user = renderReview();

      expect(await screen.findByText(/Something went wrong on our side/)).toBeInTheDocument();
      expect(screen.queryByText("Promotion batch not found")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Try again" }));

      const title = await screen.findByRole("heading", { level: 1, name: "Promotion batch" });
      expect(title).toBeInTheDocument();
      expect(mockFetchBatch).toHaveBeenCalledTimes(2);
    });
  });

  describe("acting on the batch", () => {
    it("shows the new status once a transition is confirmed", async () => {
      mockFetchBatch.mockResolvedValueOnce(batchIn("draft"));
      mockFetchBatch.mockResolvedValue(batchIn("pending_approval"));
      const user = renderReview();

      await user.click(await screen.findByRole("button", { name: "Submit for approval" }));
      const dialog = await screen.findByRole("alertdialog");
      await user.click(within(dialog).getByRole("button", { name: "Submit for approval" }));

      expect(await screen.findByText("Pending approval")).toBeInTheDocument();
      expect(screen.queryByText("Draft")).not.toBeInTheDocument();
      expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Submit for approval" })).not.toBeInTheDocument();
      expect(mockFetchBatch).toHaveBeenCalledTimes(2);
    });

    it("shows the real status when a transition loses a race, dialog still open", async () => {
      // Someone else submitted the batch while this page showed it as a draft.
      mockFetchBatch.mockResolvedValueOnce(batchIn("draft"));
      mockFetchBatch.mockResolvedValue(batchIn("pending_approval"));
      mockTransition.mockRejectedValue(apiError(409, "conflict"));
      const user = renderReview();

      await user.click(await screen.findByRole("button", { name: "Submit for approval" }));
      const dialog = await screen.findByRole("alertdialog");
      await user.click(within(dialog).getByRole("button", { name: "Submit for approval" }));

      expect(await within(dialog).findByText(/That change conflicts/)).toBeInTheDocument();
      expect(await screen.findByText("Pending approval")).toBeInTheDocument();
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });

    it("shows an edited decision once it is saved", async () => {
      const edited = promotionDecision({ student_name: "Ayesha Khan", remarks: "Parents agreed." });
      mockFetchBatch.mockResolvedValueOnce(batchIn("draft"));
      mockFetchBatch.mockResolvedValue(promotionBatchDetail({ decisions: [edited] }));
      const user = renderReview();

      const edit = await screen.findByRole("button", { name: "Edit decision for Ayesha Khan" });
      await user.click(edit);
      const dialog = await screen.findByRole("dialog", { name: "Edit decision" });
      await user.type(within(dialog).getByRole("textbox", { name: "Remarks" }), "Parents agreed.");
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      await waitFor(() => {
        const row = screen.getByRole("row", { name: /Ayesha Khan/ });
        expect(within(row).getByText("Parents agreed.")).toBeInTheDocument();
      });
      expect(mockUpdate).toHaveBeenCalledWith(BATCH_ID, studentUuid(1), {
        remarks: "Parents agreed.",
      });
    });
  });
});
