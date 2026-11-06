import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockDownloadBlob = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      refresh: jest.fn(),
      downloadBlob: mockDownloadBlob,
    })),
  };
});

describe("vouchers-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockDownloadBlob.mockReset();
  });

  it("listVouchers GETs the list path with only the filters given", async () => {
    const { listVouchers } = await import("../vouchers-service");
    mockGet.mockResolvedValue({
      data: [],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 20 } },
    });

    await listVouchers({ student: "s1", status: "issued", pageSize: 100 });

    expect(mockGet).toHaveBeenCalledWith(
      "/vouchers",
      expect.objectContaining({ query: { student: "s1", status: "issued", page_size: 100 } }),
    );
  });

  it("downloadVoucher streams the PDF of the voucher", async () => {
    const { downloadVoucher } = await import("../vouchers-service");
    const blob = new Blob(["x"]);
    mockDownloadBlob.mockResolvedValue(blob);

    await expect(downloadVoucher("v1")).resolves.toBe(blob);
    expect(mockDownloadBlob).toHaveBeenCalledWith("/vouchers/v1/download", {
      query: { format: "pdf" },
    });
  });
});
