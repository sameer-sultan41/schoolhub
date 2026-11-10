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

describe("refunds-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("listRefunds GETs the list path with the filters under the API's names", async () => {
    const { listRefunds } = await import("../refunds-service");
    mockGet.mockResolvedValue({
      data: [],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
    });

    await listRefunds({ status: "requested", paymentId: "p1", ordering: "-created_at" });

    expect(mockGet).toHaveBeenCalledWith(
      "/refunds",
      expect.objectContaining({
        query: { status: "requested", payment: "p1", ordering: "-created_at", page_size: 25 },
      }),
    );
  });

  it("createRefund POSTs the colon-action with the Idempotency-Key", async () => {
    const { createRefund } = await import("../refunds-service");
    mockPost.mockResolvedValue({ data: { id: "r1" } });

    await expect(
      createRefund({ paymentId: "p1", amount: "50.00", reason: "Twice" }, "key-1"),
    ).resolves.toEqual({ id: "r1" });

    expect(mockPost).toHaveBeenCalledWith(
      "/refunds:create",
      { payment: "p1", amount: "50.00", reason: "Twice" },
      { idempotencyKey: "key-1" },
    );
  });

  it("approveRefund and rejectRefund POST their colon-actions with the note", async () => {
    const { approveRefund, rejectRefund } = await import("../refunds-service");
    mockPost.mockResolvedValue({ data: { id: "r1" } });

    await approveRefund("r1", { note: "ok" });
    await rejectRefund("r1", { note: "No" });
    await approveRefund("r1");

    expect(mockPost).toHaveBeenNthCalledWith(1, "/refunds/r1:approve", { note: "ok" });
    expect(mockPost).toHaveBeenNthCalledWith(2, "/refunds/r1:reject", { note: "No" });
    expect(mockPost).toHaveBeenNthCalledWith(3, "/refunds/r1:approve", {});
  });

  it("processRefund POSTs the colon-action with the method, reference and Idempotency-Key", async () => {
    const { processRefund } = await import("../refunds-service");
    mockPost.mockResolvedValue({ data: { id: "r1" } });

    await processRefund("r1", { method: "cheque", referenceNo: "C-1" }, "key-2");

    expect(mockPost).toHaveBeenCalledWith(
      "/refunds/r1:process",
      { method: "cheque", reference_no: "C-1" },
      { idempotencyKey: "key-2" },
    );
  });
});
