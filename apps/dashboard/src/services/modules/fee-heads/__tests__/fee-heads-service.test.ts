import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockDelete = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: mockPost,
      put: jest.fn(),
      patch: mockPatch,
      delete: mockDelete,
      refresh: jest.fn(),
    })),
  };
});

const PAGE = {
  data: [{ id: "x1" }],
  meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 20 } },
};

const INPUT = {
  name: "Tuition",
  code: "TUI",
  category: "tuition" as const,
  ledgerAccountId: "l1",
  isRefundable: false,
  isActive: true,
};

describe("fee-heads-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it("listFeeHeads GETs /fee-heads as a cursor page with the filters mapped to the API's names", async () => {
    const { listFeeHeads } = await import("../fee-heads-service");
    mockGet.mockResolvedValue(PAGE);

    const page = await listFeeHeads({
      category: "tuition",
      ledgerAccountId: "l1",
      isActive: true,
      search: "tu",
      cursor: "c1",
      pageSize: 20,
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/fee-heads",
      expect.objectContaining({
        query: expect.objectContaining({
          category: "tuition",
          ledger_account_id: "l1",
          is_active: true,
          search: "tu",
          cursor: "c1",
          page_size: 20,
        }),
      }),
    );
    expect(page.items).toEqual([{ id: "x1" }]);
  });

  it("listFeeHeads sends no filter it was not given", async () => {
    const { listFeeHeads } = await import("../fee-heads-service");
    mockGet.mockResolvedValue(PAGE);

    await listFeeHeads();

    const query = (mockGet.mock.calls[0] as [string, { query: Record<string, unknown> }])[1].query;
    expect(Object.keys(query)).toEqual(["page_size"]);
  });

  it("fetchFeeHead GETs /fee-heads/{id}", async () => {
    const { fetchFeeHead } = await import("../fee-heads-service");
    mockGet.mockResolvedValue({ data: { id: "x1" } });

    await expect(fetchFeeHead("x1")).resolves.toEqual({ id: "x1" });

    expect(mockGet).toHaveBeenCalledWith("/fee-heads/x1");
  });

  it("createFeeHead POSTs /fee-heads with the snake_case body", async () => {
    const { createFeeHead } = await import("../fee-heads-service");
    mockPost.mockResolvedValue({ data: { id: "x1" } });

    await createFeeHead(INPUT);

    expect(mockPost).toHaveBeenCalledWith("/fee-heads", {
      name: "Tuition",
      code: "TUI",
      category: "tuition",
      ledger_account: "l1",
      is_refundable: false,
      is_active: true,
    });
  });

  it("updateFeeHead PATCHes /fee-heads/{id} with only the fields given", async () => {
    const { updateFeeHead } = await import("../fee-heads-service");
    mockPatch.mockResolvedValue({ data: { id: "x1" } });

    await updateFeeHead("x1", { name: "Renamed" });

    expect(mockPatch).toHaveBeenCalledWith("/fee-heads/x1", { name: "Renamed" });
  });

  it("deleteFeeHead DELETEs /fee-heads/{id}", async () => {
    const { deleteFeeHead } = await import("../fee-heads-service");
    mockDelete.mockResolvedValue({});

    await deleteFeeHead("x1");

    expect(mockDelete).toHaveBeenCalledWith("/fee-heads/x1");
  });
});
