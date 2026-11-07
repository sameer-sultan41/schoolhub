import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();

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
      downloadBlob: jest.fn(),
    })),
  };
});

describe("payments-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
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
});
