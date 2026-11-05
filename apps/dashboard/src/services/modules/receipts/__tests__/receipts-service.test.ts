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

describe("receipts-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDownloadBlob.mockReset();
  });

  it("listReceipts GETs the list path with only the filters given", async () => {
    const { listReceipts } = await import("../receipts-service");
    mockGet.mockResolvedValue(PAGE);

    await listReceipts({ payment: "p1", pageSize: 20 });

    expect(mockGet).toHaveBeenCalledWith(
      "/receipts",
      expect.objectContaining({ query: { payment: "p1", page_size: 20 } }),
    );
  });

  it("fetchReceipt GETs the detail path", async () => {
    const { fetchReceipt } = await import("../receipts-service");
    mockGet.mockResolvedValue({ data: { id: "x1" } });

    await fetchReceipt("x1");

    expect(mockGet).toHaveBeenCalledWith("/receipts/x1");
  });

  it("downloadReceipt streams the download path with the format", async () => {
    const { downloadReceipt } = await import("../receipts-service");
    const blob = new Blob(["%PDF"]);
    mockDownloadBlob.mockResolvedValue(blob);

    expect(await downloadReceipt("r1", "thermal")).toBe(blob);
    expect(mockDownloadBlob).toHaveBeenCalledWith("/receipts/r1/download", {
      query: { format: "thermal" },
    });
  });
});
