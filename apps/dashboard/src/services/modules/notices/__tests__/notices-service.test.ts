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

describe("notices-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDownloadBlob.mockReset();
  });

  it("listNotices GETs the list path with the guardian-readable filters", async () => {
    const { listNotices } = await import("../notices-service");
    mockGet.mockResolvedValue(PAGE);

    await listNotices({ noticeType: "urgent", requiresAcknowledgment: true, pageSize: 20 });

    expect(mockGet).toHaveBeenCalledWith(
      "/notices",
      expect.objectContaining({
        query: { notice_type: "urgent", requires_acknowledgment: true, page_size: 20 },
      }),
    );
  });

  it("fetchNotice GETs the detail path", async () => {
    const { fetchNotice } = await import("../notices-service");
    mockGet.mockResolvedValue({ data: { id: "n1" } });

    await fetchNotice("n1");

    expect(mockGet).toHaveBeenCalledWith("/notices/n1");
  });

  it("acknowledgeNotice POSTs the acknowledge colon-action", async () => {
    const { acknowledgeNotice } = await import("../notices-service");
    mockPost.mockResolvedValue({ data: undefined });

    await acknowledgeNotice("n1");

    expect(mockPost).toHaveBeenCalledWith("/notices/n1:acknowledge");
  });
});
