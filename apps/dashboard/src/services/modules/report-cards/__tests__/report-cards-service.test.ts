import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: mockPost,
      put: jest.fn(),
      patch: mockPatch,
      delete: jest.fn(),
      refresh: jest.fn(),
    })),
  };
});

describe("report-cards-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  it("reads one cursor page of an exam's cards, filtered by section and status", async () => {
    const { fetchReportCardsPage } = await import("../report-cards-service");
    mockGet.mockResolvedValue({
      data: [{ id: "rc1" }],
      meta: { pagination: { next_cursor: null, has_more: false } },
    });

    const page = await fetchReportCardsPage({
      examId: "e1",
      pageSize: 25,
      sectionId: "s1",
      status: "generated",
    });

    expect(page.items).toEqual([{ id: "rc1" }]);
    expect(mockGet).toHaveBeenCalledWith(
      "/report-cards",
      expect.objectContaining({
        query: expect.objectContaining({
          exam_id: "e1",
          page_size: 25,
          section_id: "s1",
          status: "generated",
        }),
      }),
    );
  });

  it("queues generation with the Idempotency-Key, returning the job", async () => {
    const { generateReportCards } = await import("../report-cards-service");
    mockPost.mockResolvedValue({ data: { job_id: "j1", status: "queued" } });

    await expect(generateReportCards("e1", "key-1")).resolves.toEqual({ jobId: "j1" });
    expect(mockPost).toHaveBeenCalledWith("/exams/e1:generate-report-cards", undefined, {
      idempotencyKey: "key-1",
    });
  });

  it("publishes through the exam's colon-action, returning the server's count", async () => {
    const { publishReportCards } = await import("../report-cards-service");
    mockPost.mockResolvedValue({ data: { published: 4, published_ids: [] } });

    await expect(publishReportCards("e1")).resolves.toEqual({ published: 4, published_ids: [] });
    expect(mockPost).toHaveBeenCalledWith("/exams/e1:publish-report-cards");
  });

  it("patches only the remark fields it is given", async () => {
    const { updateRemarks } = await import("../report-cards-service");
    mockPatch.mockResolvedValue({ data: { id: "rc1", principal_remarks: "Well done." } });

    await updateRemarks("rc1", { principal_remarks: "Well done." });

    expect(mockPatch).toHaveBeenCalledWith("/report-cards/rc1", {
      principal_remarks: "Well done.",
    });
  });

  it("asks the card's own download action for its link", async () => {
    const { fetchReportCardDownloadUrl } = await import("../report-cards-service");
    mockPost.mockResolvedValue({ data: { download_url: "https://files.test/rc1.pdf" } });

    await expect(fetchReportCardDownloadUrl("rc1")).resolves.toBe("https://files.test/rc1.pdf");
    expect(mockPost).toHaveBeenCalledWith("/report-cards/rc1:download");
  });
});
