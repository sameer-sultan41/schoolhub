import { ApiError, type ApiResult } from "@schoolhub/api-client";
import { screen, within } from "@testing-library/react";
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

/** The class and section lists, in mutable bindings so one test can hold them in
 * the `data: undefined` state the table paints before they arrive. */
interface Option {
  id: string;
  name: string;
  class_id?: string;
}
const CLASSES: Option[] = [
  { id: "class8", name: "Grade 8" },
  { id: "class9", name: "Grade 9" },
];
const SECTIONS: Option[] = [{ id: "sec9a", name: "A", class_id: "class9" }];
let mockClasses: { data: Option[] | undefined } = { data: CLASSES };
let mockSections: { data: Option[] | undefined } = { data: SECTIONS };

jest.mock("@/features/students/use-reference-data", () => ({
  useClasses: () => mockClasses,
}));
jest.mock("@/features/academics/use-academics-reference-data", () => ({
  useSections: () => mockSections,
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

/** A retained student: §6 re-enrols them in the class they were already in, so
 * the target class is the source class rather than nothing. `graduated` is the
 * only decision the model lets carry a null `to_class_id`
 * (`promotions_target_class_matches_decision`), and the API now refuses a
 * `retained` row that names any other class — so a null here was a row the
 * database would not have held. Section and remarks are genuinely unset. */
const RETAINED_ROW: PromotionDecisionRecord = {
  ...DRAFT_ROW,
  id: "dec2",
  decision: "retained",
  to_class_id: "class8",
  to_section_id: null,
  remarks: null,
};

/** `GET /student-promotions/{batch_id}` — the batch and its decisions inline. */
function batch(decisions: unknown[], status = "draft"): ApiResult<unknown> {
  return {
    data: {
      batch_id: "batch-1",
      from_academic_session_id: "sess1",
      to_academic_session_id: "sess2",
      from_class_id: "class1",
      status,
      students: decisions.length,
      started_at: "2026-04-01T00:00:00Z",
      decisions,
    },
    meta: undefined,
    requestId: null,
    status: 200,
  };
}

describe("PromotionBatchReview", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUsePermission.mockReturnValue(false);
    mockClasses = { data: CLASSES };
    mockSections = { data: SECTIONS };
  });

  it("lists the batch's rows by batch_id and resolves class and section names", async () => {
    mockGet.mockResolvedValue(batch([DRAFT_ROW]));

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
    expect(mockGet.mock.calls[0]?.[0]).toBe("/student-promotions/batch-1");
  });

  it("reads the batch state off the batch and hands it to the action bar", async () => {
    mockGet.mockResolvedValue(batch([DRAFT_ROW]));

    renderWithProviders(<PromotionBatchReview batchId="batch-1" />);

    const actions = await screen.findByTestId("batch-actions");
    expect(actions).toHaveAttribute("data-status", "draft");
    expect(actions).toHaveAttribute("data-batch-id", "batch-1");
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("takes the batch's own status, not its first row's", async () => {
    /**
     * The regression: status came from `rows[0]?.status`, which was only ever
     * right because there was no batch resource for it to disagree with. There
     * is one now, and the serializer *groups on* status precisely so that a
     * batch whose rows diverged is visible rather than papered over by whichever
     * row happened to sort first.
     */
    mockGet.mockResolvedValue(batch([{ ...DRAFT_ROW, status: "draft" }], "approved"));

    renderWithProviders(<PromotionBatchReview batchId="batch-1" />);

    const actions = await screen.findByTestId("batch-actions");
    expect(actions).toHaveAttribute("data-status", "approved");
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
  });

  it("offers the per-row editor only while the batch is draft and the user may update", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(batch([DRAFT_ROW]));

    renderWithProviders(<PromotionBatchReview batchId="batch-1" />);

    expect(await screen.findByTestId("decision-form")).toBeInTheDocument();
  });

  it("withdraws the per-row editor once the batch has left draft", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(batch([{ ...DRAFT_ROW, status: "approved" }], "approved"));

    renderWithProviders(<PromotionBatchReview batchId="batch-1" />);

    expect(await screen.findByText("Approved")).toBeInTheDocument();
    expect(screen.queryByTestId("decision-form")).not.toBeInTheDocument();
  });

  it("hides the per-row editor without the update permission", async () => {
    mockGet.mockResolvedValue(batch([DRAFT_ROW]));

    renderWithProviders(<PromotionBatchReview batchId="batch-1" />);

    await screen.findByText("Draft");
    expect(screen.queryByTestId("decision-form")).not.toBeInTheDocument();
  });

  it("shows the empty state when a batch answers with no decisions", async () => {
    // The action bar stays, and that is the point of reading status off the
    // batch: the resource answered, so the batch exists and has a state, where
    // before this the whole bar vanished the moment `rows[0]` did. A batch with
    // no rows is a 404 from `retrieve` in practice (the ApiError case covers
    // that), so this exercises the table's own empty branch.
    mockGet.mockResolvedValue(batch([]));

    renderWithProviders(<PromotionBatchReview batchId="batch-1" />);

    expect(await screen.findByText("This batch has no decisions")).toBeInTheDocument();
    expect(screen.getByTestId("batch-actions")).toBeInTheDocument();
  });

  it("renders the ApiError envelope in the table's error slot on failure", async () => {
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
    // The table stays put — the envelope now goes into its own error slot — but the
    // empty state must NOT appear: a failed request is not an empty result set, and
    // saying so would tell the reader something untrue about their own school.
    expect(screen.queryByText("This batch has no decisions")).not.toBeInTheDocument();
  });

  it("links back to the batch list", async () => {
    mockGet.mockResolvedValue(batch([DRAFT_ROW]));

    renderWithProviders(<PromotionBatchReview batchId="batch-1" />);

    expect(await screen.findByRole("link", { name: "All batches" })).toHaveAttribute(
      "href",
      "/academics/promotions",
    );
  });

  it("shows a retained student staying in their own class, em-dashing what is unset", async () => {
    mockGet.mockResolvedValue(batch([RETAINED_ROW]));

    renderWithProviders(<PromotionBatchReview batchId="batch-1" />);

    const link = await screen.findByRole("link", { name: "stu-1" });
    const row = link.closest("tr") as HTMLElement;
    expect(within(row).getByText("Retained")).toBeInTheDocument();
    // From class and target class, both Grade 8 — that is what retention means.
    expect(within(row).getAllByText("Grade 8")).toHaveLength(2);
    expect(within(row).getAllByText("—")).toHaveLength(2);
  });

  it("falls back to em dashes for the class and section names while the reference lists load", async () => {
    mockClasses = { data: undefined };
    mockSections = { data: undefined };
    mockGet.mockResolvedValue(batch([DRAFT_ROW]));

    renderWithProviders(<PromotionBatchReview batchId="batch-1" />);

    const link = await screen.findByRole("link", { name: "stu-1" });
    const row = link.closest("tr") as HTMLElement;
    // From class, target class and target section are all id lookups into lists
    // that have not arrived; the remarks are on the row itself, so they still show.
    expect(within(row).getAllByText("—")).toHaveLength(3);
    expect(within(row).getByText("Borderline in maths.")).toBeInTheDocument();
  });
});
