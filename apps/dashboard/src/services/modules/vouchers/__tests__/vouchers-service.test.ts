import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDownloadBlob = jest.fn();

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
      downloadBlob: mockDownloadBlob,
    })),
  };
});

describe("vouchers-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
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

  it("listVouchers sends the provider and sort under the API's names", async () => {
    const { listVouchers } = await import("../vouchers-service");
    mockGet.mockResolvedValue({
      data: [],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
    });

    await listVouchers({ provider: "easypaisa", ordering: "-due_date" });

    expect(mockGet).toHaveBeenCalledWith(
      "/vouchers",
      expect.objectContaining({
        query: { provider: "easypaisa", ordering: "-due_date", page_size: 25 },
      }),
    );
  });

  it("issueVoucher POSTs to the invoice's vouchers path with the provider and validity", async () => {
    const { issueVoucher } = await import("../vouchers-service");
    mockPost.mockResolvedValue({ data: { id: "v1", consumer_number: "123" } });

    const voucher = await issueVoucher("i1", { provider: "jazzcash", validityDays: 30 });

    expect(voucher).toEqual({ id: "v1", consumer_number: "123" });
    expect(mockPost).toHaveBeenCalledWith("/fee-invoices/i1/vouchers", {
      provider: "jazzcash",
      validity_days: 30,
    });
  });

  it("issueVoucher leaves the validity out when none is given", async () => {
    const { issueVoucher } = await import("../vouchers-service");
    mockPost.mockResolvedValue({ data: { id: "v1" } });

    await issueVoucher("i1", { provider: "bank_branch", validityDays: null });

    expect(mockPost).toHaveBeenCalledWith("/fee-invoices/i1/vouchers", {
      provider: "bank_branch",
    });
  });

  it("voidVoucher POSTs the colon-action with the reason", async () => {
    const { voidVoucher } = await import("../vouchers-service");
    mockPost.mockResolvedValue({ data: { id: "v1", status: "void" } });

    await expect(voidVoucher("v1", "Wrong family")).resolves.toEqual({ id: "v1", status: "void" });
    expect(mockPost).toHaveBeenCalledWith("/vouchers/v1:void", { reason: "Wrong family" });
  });
});
