import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockDownloadBlob = jest.fn();

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
      downloadBlob: mockDownloadBlob,
    })),
  };
});

const PAGE = {
  data: [{ id: "x1" }],
  meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 20 } },
};

describe("report-cards-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDownloadBlob.mockReset();
  });

  it("listReportCards GETs the list path with only the filters given", async () => {
    const { listReportCards } = await import("../report-cards-service");
    mockGet.mockResolvedValue(PAGE);

    await listReportCards({ studentId: "s1", pageSize: 20 });

    expect(mockGet).toHaveBeenCalledWith(
      "/report-cards",
      expect.objectContaining({ query: { student_id: "s1", page_size: 20 } }),
    );
  });

  it("fetchReportCard GETs the detail path", async () => {
    const { fetchReportCard } = await import("../report-cards-service");
    mockGet.mockResolvedValue({ data: { id: "x1" } });

    await fetchReportCard("x1");

    expect(mockGet).toHaveBeenCalledWith("/report-cards/x1");
  });
});
