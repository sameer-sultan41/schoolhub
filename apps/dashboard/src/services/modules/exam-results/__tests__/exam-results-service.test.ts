import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: mockPost,
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      refresh: jest.fn(),
    })),
  };
});

describe("exam-results-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("reads one cursor page of an exam's results, filtered by section, outcome and status", async () => {
    const { fetchResultsPage } = await import("../exam-results-service");
    mockGet.mockResolvedValue({
      data: [{ id: "r1" }],
      meta: { pagination: { next_cursor: null, has_more: false } },
    });

    const page = await fetchResultsPage({
      examId: "e1",
      pageSize: 25,
      ordering: "-percentage",
      sectionId: "s1",
      outcome: "pass",
      status: "pending_approval",
    });

    expect(page.items).toEqual([{ id: "r1" }]);
    expect(mockGet).toHaveBeenCalledWith(
      "/results",
      expect.objectContaining({
        query: expect.objectContaining({
          exam_id: "e1",
          page_size: 25,
          ordering: "-percentage",
          section_id: "s1",
          outcome: "pass",
          status: "pending_approval",
        }),
      }),
    );
  });

  it("queues processing with the Idempotency-Key, returning the job", async () => {
    const { processResults } = await import("../exam-results-service");
    mockPost.mockResolvedValue({ data: { job_id: "j1", status: "queued" } });

    await expect(processResults("e1", "key-1")).resolves.toEqual({ jobId: "j1" });
    expect(mockPost).toHaveBeenCalledWith("/exams/e1:process-results", undefined, {
      idempotencyKey: "key-1",
    });
  });

  it("approves, sends back with a reason and publishes through the exam's colon-actions", async () => {
    const service = await import("../exam-results-service");
    mockPost
      .mockResolvedValueOnce({ data: { approved: 3 } })
      .mockResolvedValueOnce({ data: { reopened: 3, reason: "Recheck maths" } })
      .mockResolvedValueOnce({ data: { published: 2, withheld: 1, published_ids: ["a", "b"] } });

    await expect(service.approveResults("e1")).resolves.toEqual({ approved: 3 });
    await expect(service.sendResultsBack("e1", "Recheck maths")).resolves.toEqual({
      reopened: 3,
      reason: "Recheck maths",
    });
    await expect(service.publishResults("e1")).resolves.toEqual({
      published: 2,
      withheld: 1,
      published_ids: ["a", "b"],
    });
    expect(mockPost).toHaveBeenNthCalledWith(1, "/exams/e1:approve-results");
    expect(mockPost).toHaveBeenNthCalledWith(2, "/exams/e1:send-results-back", {
      reason: "Recheck maths",
    });
    expect(mockPost).toHaveBeenNthCalledWith(3, "/exams/e1:publish-results");
  });

  it("withholds one result with the reason in the body", async () => {
    const { withholdResult } = await import("../exam-results-service");
    mockPost.mockResolvedValue({ data: { id: "r1", outcome: "withheld" } });

    await expect(withholdResult("r1", "Fees outstanding")).resolves.toEqual({
      id: "r1",
      outcome: "withheld",
    });
    expect(mockPost).toHaveBeenCalledWith("/results/r1:withhold", { reason: "Fees outstanding" });
  });
});
