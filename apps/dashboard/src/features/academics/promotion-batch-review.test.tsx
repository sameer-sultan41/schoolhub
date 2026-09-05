import { ApiError, type ApiResult } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { PromotionDecisionRecord } from "@/features/academics/academics-types";
import { PromotionBatchReview } from "@/features/academics/promotion-batch-review";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({
  apiClient: { get: jest.fn(), patch: jest.fn(), post: jest.fn() },
}));
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));
jest.mock("next/navigation", () => ({ usePathname: () => "/academics/promotions/batch-1" }));
jest.mock("@/features/students/use-reference-data", () => ({
  useClasses: () => ({
    data: [
      { id: "class8", name: "Grade 8" },
      { id: "class9", name: "Grade 9" },
    ],
  }),
}));
jest.mock("@/features/academics/use-academics-reference-data", () => ({
  useSections: () => ({ data: [{ id: "sec9a", name: "A", class_id: "class9" }] }),
}));
// Both have their own specs; stubbing them keeps this one about the review table.
jest.mock("@/features/academics/promotion-batch-actions", () => ({
  PromotionBatchActions: ({ batchId, status }: { batchId: string; status: string }) => (
    <div data-testid="batch-actions" data-batch-id={batchId} data-status={status} />
  ),
}));
jest.mock("@/features/academics/promotion-decision-form", () => ({
  PromotionDecisionForm: () => <div data-testid="decision-form" />,
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;

const DRAFT_ROW: PromotionDecisionRecord = {
  id: "dec1",
  batch_id: "batch-1",
  student_id: "stu-1",
  from_enrollment_id: "enr-1",
  from_academic_session_id: "sess1",
  to_academic_session_id: "sess2",
  from_class_id: "class8",
  to_class_id: "class9",
  to_section_id: "sec9a",
  decision: "promoted",
  decision_basis: null,
  override_reason: null,
  remarks: "Borderline in maths.",
  status: "draft",
  approved_by: null,
  approved_at: null,
  executed_at: null,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

function page(items: unknown[], nextCursor: string | null = null): ApiResult<unknown> {
  return {
    data: items,
    meta: { pagination: { next_cursor: nextCursor, previous_cursor: null, page_size: 25 } },
    requestId: "req-list",
    status: 200,
  };
}

describe("PromotionBatchReview", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUsePermission.mockReturnValue(false);
  });

  it("lists the batch's rows by batch_id and resolves class and section names", async () => {
    mockGet.mockResolvedValue(page([DRAFT_ROW]));

    renderWithProviders(<PromotionBatchReview batchId="batch-1" />);

    expect(await screen.findByRole("link", { name: "stu-1" })).toHaveAttribute(
      "href",
      "/students/stu-1",
    );
    expect(screen.getByText("Grade 8")).toBeInTheDocument();
    expect(screen.getByText("Grade 9")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("Promoted")).toBeInTheDocument();
    expect(screen.getByText("Borderline in maths.")).toBeInTheDocument();
    expect(mockGet.mock.calls[0]?.[1]?.query).toMatchObject({ batch_id: "batch-1" });
  });

  it("reads the batch state off the rows and hands it to the action bar", async () => {
    mockGet.mockResolvedValue(page([DRAFT_ROW]));

    renderWithProviders(<PromotionBatchReview batchId="batch-1" />);

    const actions = await screen.findByTestId("batch-actions");
    expect(actions).toHaveAttribute("data-status", "draft");
    expect(actions).toHaveAttribute("data-batch-id", "batch-1");
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("offers the per-row editor only while the batch is draft and the user may update", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(page([DRAFT_ROW]));

    renderWithProviders(<PromotionBatchReview batchId="batch-1" />);

    expect(await screen.findByTestId("decision-form")).toBeInTheDocument();
  });

  it("withdraws the per-row editor once the batch has left draft", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(page([{ ...DRAFT_ROW, status: "approved" }]));

    renderWithProviders(<PromotionBatchReview batchId="batch-1" />);

    expect(await screen.findByText("Approved")).toBeInTheDocument();
    expect(screen.queryByTestId("decision-form")).not.toBeInTheDocument();
  });

  it("hides the per-row editor without the update permission", async () => {
    mockGet.mockResolvedValue(page([DRAFT_ROW]));

    renderWithProviders(<PromotionBatchReview batchId="batch-1" />);

    await screen.findByText("Draft");
    expect(screen.queryByTestId("decision-form")).not.toBeInTheDocument();
  });

  it("shows the empty state and no action bar for an unknown batch", async () => {
    mockGet.mockResolvedValue(page([]));

    renderWithProviders(<PromotionBatchReview batchId="batch-1" />);

    expect(await screen.findByText("This batch has no decisions.")).toBeInTheDocument();
    expect(screen.queryByTestId("batch-actions")).not.toBeInTheDocument();
  });

  it("renders the ApiError envelope instead of the table on failure", async () => {
    mockGet.mockRejectedValue(
      new ApiError({
        code: "not_found",
        message: "gone",
        status: 404,
        url: "/student-promotions",
        requestId: "req-11",
      }),
    );

    renderWithProviders(<PromotionBatchReview batchId="batch-1" />);

    expect(
      await screen.findByText(/could not find what you were looking for/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-11/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("pages forward by cursor", async () => {
    mockGet.mockResolvedValue(page([DRAFT_ROW], "cursor-2"));

    renderWithProviders(<PromotionBatchReview batchId="batch-1" />);
    await screen.findByText("Grade 8");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query?.cursor).toBe("cursor-2");
    });
  });

  it("links back to the batch list", async () => {
    mockGet.mockResolvedValue(page([DRAFT_ROW]));

    renderWithProviders(<PromotionBatchReview batchId="batch-1" />);

    expect(await screen.findByRole("link", { name: "All batches" })).toHaveAttribute(
      "href",
      "/academics/promotions",
    );
  });
});
