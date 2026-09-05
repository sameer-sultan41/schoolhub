import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PromotionBatchActions } from "@/features/academics/promotion-batch-actions";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;

function ok(data: unknown) {
  return { data, meta: undefined, requestId: null, status: 200 };
}

/** What `GET /jobs/{id}` answers with — `core.jobs.serializers.BackgroundJob`. */
function job(overrides: Record<string, unknown>) {
  return ok({
    id: "job-1",
    job_type: "promotion.execute",
    status: "queued",
    progress: 0,
    result: null,
    error: null,
    started_at: null,
    finished_at: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  });
}

const REPORT = {
  enrolled: [{ student_id: "stu-1" }],
  graduated: [],
  skipped: [{ student_id: "stu-2", reason: "already executed" }],
  failed: [{ student_id: "stu-3", error: "No guardian on record." }],
};

describe("PromotionBatchActions", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockUsePermission.mockReturnValue(true);
  });

  it("offers only Submit while the batch is a draft", () => {
    renderWithProviders(<PromotionBatchActions batchId="batch-1" status="draft" />);

    expect(screen.getByRole("button", { name: "Submit for approval" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Execute" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revert" })).not.toBeInTheDocument();
  });

  it("posts the :submit colon-action", async () => {
    mockPost.mockResolvedValue(ok({ updated: 30 }));
    const user = userEvent.setup();

    renderWithProviders(<PromotionBatchActions batchId="batch-1" status="draft" />);
    await user.click(screen.getByRole("button", { name: "Submit for approval" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/student-promotions/batch-1:submit");
    });
  });

  it("offers Approve and Reject while pending approval", async () => {
    mockPost.mockResolvedValue(ok({ updated: 30 }));
    const user = userEvent.setup();

    renderWithProviders(<PromotionBatchActions batchId="batch-1" status="pending_approval" />);

    expect(screen.queryByRole("button", { name: "Submit for approval" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/student-promotions/batch-1:reject");
    });
  });

  it("posts the :approve colon-action", async () => {
    mockPost.mockResolvedValue(ok({ updated: 30 }));
    const user = userEvent.setup();

    renderWithProviders(<PromotionBatchActions batchId="batch-1" status="pending_approval" />);
    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/student-promotions/batch-1:approve");
    });
  });

  it("queues execution with an idempotency key and polls the job for the report", async () => {
    /**
     * `:execute` answers `202` and a job id — the server runs a class of students
     * one commit at a time on a worker. The per-student report only exists as the
     * finished job's `result`, so awaiting the POST's own body (which this used
     * to do) would have nothing in it to render.
     */
    mockPost.mockResolvedValue(ok({ job_id: "job-1", status: "queued" }));
    mockGet.mockResolvedValue(job({ status: "succeeded", progress: 100, result: REPORT }));
    const user = userEvent.setup();

    renderWithProviders(<PromotionBatchActions batchId="batch-1" status="approved" />);
    await user.click(screen.getByRole("button", { name: "Execute" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/student-promotions/batch-1:execute", undefined, {
        idempotencyKey: expect.any(String) as string,
      });
    });
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith("/jobs/job-1");
    });

    expect(await screen.findByText("Execution report")).toBeInTheDocument();
    expect(screen.getByText("Enrolled in the next session: 1")).toBeInTheDocument();
    expect(screen.getByText("Graduated: 0")).toBeInTheDocument();
    expect(screen.getByText("Skipped: 1")).toBeInTheDocument();
    expect(screen.getByText("Failed: 1")).toBeInTheDocument();
    expect(screen.getByText("stu-2 — already executed")).toBeInTheDocument();
    expect(screen.getByText("stu-3 — No guardian on record.")).toBeInTheDocument();
  });

  it("shows progress and refuses a second run while the job is still going", async () => {
    mockPost.mockResolvedValue(ok({ job_id: "job-1", status: "queued" }));
    mockGet.mockResolvedValue(job({ status: "running", progress: 40 }));
    const user = userEvent.setup();

    const rendered = renderWithProviders(
      <PromotionBatchActions batchId="batch-1" status="approved" />,
    );
    await user.click(screen.getByRole("button", { name: "Execute" }));

    expect(await screen.findByText("Executing — 40%")).toBeInTheDocument();
    expect(screen.queryByText("Execution report")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Execute" })).toBeDisabled();

    // The poll re-runs on a timer for as long as anything is observing it.
    rendered.unmount();
  });

  it("surfaces the job's own error when the batch fails on the worker", async () => {
    mockPost.mockResolvedValue(ok({ job_id: "job-1", status: "queued" }));
    mockGet.mockResolvedValue(job({ status: "failed", error: "No such promotion batch." }));
    const user = userEvent.setup();

    renderWithProviders(<PromotionBatchActions batchId="batch-1" status="approved" />);
    await user.click(screen.getByRole("button", { name: "Execute" }));

    expect(await screen.findByText("No such promotion batch.")).toBeInTheDocument();
    expect(screen.queryByText("Execution report")).not.toBeInTheDocument();
  });

  it("offers Revert on an approved and on an executed batch", () => {
    const approved = renderWithProviders(
      <PromotionBatchActions batchId="batch-1" status="approved" />,
    );
    expect(screen.getByRole("button", { name: "Revert" })).toBeInTheDocument();
    approved.unmount();

    renderWithProviders(<PromotionBatchActions batchId="batch-1" status="executed" />);
    expect(screen.getByRole("button", { name: "Revert" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Execute" })).not.toBeInTheDocument();
  });

  it("offers nothing once the batch is reverted", () => {
    renderWithProviders(<PromotionBatchActions batchId="batch-1" status="reverted" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("hides every transition without its permission", () => {
    mockUsePermission.mockReturnValue(false);

    renderWithProviders(<PromotionBatchActions batchId="batch-1" status="pending_approval" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the error envelope when a transition is refused", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "You prepared this batch, so you cannot approve it.",
        status: 422,
        url: "/student-promotions/batch-1:approve",
        requestId: "req-10",
      }),
    );
    const user = userEvent.setup();

    renderWithProviders(<PromotionBatchActions batchId="batch-1" status="pending_approval" />);
    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(await screen.findByText(/isn't allowed right now/i)).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-10/)).toBeInTheDocument();
  });

  it("renders the error envelope when execution is refused before it is queued", async () => {
    // Whether a batch is executable at all is still decided synchronously, so
    // this stays a 409 on the POST rather than a job that fails out of band.
    mockPost.mockRejectedValue(
      new ApiError({
        code: "conflict",
        message: "Only an approved batch can be executed.",
        status: 409,
        url: "/student-promotions/batch-1:execute",
      }),
    );
    const user = userEvent.setup();

    renderWithProviders(<PromotionBatchActions batchId="batch-1" status="approved" />);
    await user.click(screen.getByRole("button", { name: "Execute" }));

    expect(await screen.findByText(/conflicts with the current data/i)).toBeInTheDocument();
    expect(screen.queryByText("Execution report")).not.toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
