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

  it("listFeeInvoices maps every filter to the API's name, with outstanding as a boolean", async () => {
    const { listFeeInvoices } = await import("../fee-invoices-service");
    mockGet.mockResolvedValue(PAGE);

    await listFeeInvoices({
      studentId: "s1",
      academicSessionId: "a1",
      feeStructureId: "f1",
      status: "overdue",
      periodLabel: "2026-10",
      dueDateGte: "2026-10-01",
      dueDateLte: "2026-10-31",
      outstanding: true,
      pageSize: 25,
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/fee-invoices",
      expect.objectContaining({
        query: {
          student: "s1",
          academic_session_id: "a1",
          fee_structure_id: "f1",
          status: "overdue",
          period_label: "2026-10",
          due_date__gte: "2026-10-01",
          due_date__lte: "2026-10-31",
          outstanding: true,
          page_size: 25,
        },
      }),
    );
  });

  it("createFeeInvoice POSTs the header in the API's names and leaves a blank label out", async () => {
    const { createFeeInvoice } = await import("../fee-invoices-service");
    mockPost.mockResolvedValue({ data: { id: "x1" } });

    await createFeeInvoice({
      studentId: "s1",
      academicSessionId: "a1",
      issueDate: "2026-10-01",
      dueDate: "2026-10-20",
      periodLabel: "",
    });

    expect(mockPost).toHaveBeenCalledWith("/fee-invoices", {
      student: "s1",
      academic_session: "a1",
      issue_date: "2026-10-01",
      due_date: "2026-10-20",
    });
  });

  it("generateFeeInvoices POSTs the colon-action with the Idempotency-Key, returning the job id", async () => {
    const { generateFeeInvoices } = await import("../fee-invoices-service");
    mockPost.mockResolvedValue({ data: { job_id: "j1", status: "queued" } });

    await expect(
      generateFeeInvoices(
        { feeStructureId: "f1", periodStart: "2026-10-01", termId: null },
        "key-1",
      ),
    ).resolves.toEqual({ jobId: "j1" });

    expect(mockPost).toHaveBeenCalledWith(
      "/fee-invoices:generate",
      { fee_structure: "f1", period_start: "2026-10-01" },
      { idempotencyKey: "key-1" },
    );
  });

  it("cancelFeeInvoice POSTs the colon-action with the reason", async () => {
    const { cancelFeeInvoice } = await import("../fee-invoices-service");
    mockPost.mockResolvedValue({ data: { id: "x1", status: "canceled" } });

    await cancelFeeInvoice("x1", "Raised in error");

    expect(mockPost).toHaveBeenCalledWith("/fee-invoices/x1:cancel", { reason: "Raised in error" });
  });
});
