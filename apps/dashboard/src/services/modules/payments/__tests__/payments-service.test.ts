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
      downloadBlob: jest.fn(),
    })),
  };
});

describe("payments-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("listPayments GETs the list path with the invoice filter under the API's name", async () => {
    const { listPayments } = await import("../payments-service");
    mockGet.mockResolvedValue({
      data: [],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 100 } },
    });

    await listPayments({ invoiceId: "i1", pageSize: 100 });

    expect(mockGet).toHaveBeenCalledWith(
      "/payments",
      expect.objectContaining({ query: { invoice: "i1", page_size: 100 } }),
    );
  });

  it("listPayments sends the cashier and date filters under the API's names", async () => {
    const { listPayments } = await import("../payments-service");
    mockGet.mockResolvedValue({
      data: [],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
    });

    await listPayments({
      method: "cash",
      status: "confirmed",
      paidAtGte: "2026-10-01T00:00:00Z",
      receivedBy: "u1",
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/payments",
      expect.objectContaining({
        query: {
          method: "cash",
          status: "confirmed",
          paid_at__gte: "2026-10-01T00:00:00Z",
          received_by: "u1",
          page_size: 25,
        },
      }),
    );
  });

  it("recordPayment POSTs the colon-action with the Idempotency-Key and returns the payment", async () => {
    const { recordPayment } = await import("../payments-service");
    mockPost.mockResolvedValue({ data: { id: "p1", receipt: "r1" } });

    const payment = await recordPayment(
      { feeInvoiceId: "i1", amount: "500.00", method: "cheque", referenceNo: "CHQ-9" },
      "key-1",
    );

    expect(payment).toEqual({ id: "p1", receipt: "r1" });
    expect(mockPost).toHaveBeenCalledWith(
      "/payments:record",
      { fee_invoice: "i1", amount: "500.00", method: "cheque", reference_no: "CHQ-9" },
      { idempotencyKey: "key-1" },
    );
  });

  it("recordPayment omits an empty reference", async () => {
    const { recordPayment } = await import("../payments-service");
    mockPost.mockResolvedValue({ data: { id: "p1" } });

    await recordPayment(
      { feeInvoiceId: "i1", amount: "10", method: "cash", referenceNo: null },
      "k",
    );

    expect(mockPost).toHaveBeenCalledWith(
      "/payments:record",
      { fee_invoice: "i1", amount: "10", method: "cash" },
      { idempotencyKey: "k" },
    );
  });
});
