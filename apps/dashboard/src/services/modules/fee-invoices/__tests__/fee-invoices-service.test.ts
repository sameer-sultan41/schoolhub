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

describe("fee-invoices-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDownloadBlob.mockReset();
  });

  it("listFeeInvoices GETs the list path with only the filters given", async () => {
    const { listFeeInvoices } = await import("../fee-invoices-service");
    mockGet.mockResolvedValue(PAGE);

    await listFeeInvoices({ studentId: "s1", pageSize: 20 });

    expect(mockGet).toHaveBeenCalledWith(
      "/fee-invoices",
      expect.objectContaining({ query: { student: "s1", page_size: 20 } }),
    );
  });

  it("fetchFeeInvoice GETs the detail path", async () => {
    const { fetchFeeInvoice } = await import("../fee-invoices-service");
    mockGet.mockResolvedValue({ data: { id: "x1" } });

    await fetchFeeInvoice("x1");

    expect(mockGet).toHaveBeenCalledWith("/fee-invoices/x1");
  });
});
