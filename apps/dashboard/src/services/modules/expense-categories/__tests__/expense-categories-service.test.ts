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
      downloadBlob: jest.fn(),
    })),
  };
});

describe("expense-categories-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it("listExpenseCategories sends the filters under the API's names", async () => {
    const { listExpenseCategories } = await import("../expense-categories-service");
    mockGet.mockResolvedValue({
      data: [],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
    });

    await listExpenseCategories({ isActive: true, ledgerAccountId: "a1", ordering: "code" });

    expect(mockGet).toHaveBeenCalledWith(
      "/expense-categories",
      expect.objectContaining({
        query: { is_active: true, ledger_account_id: "a1", ordering: "code" },
      }),
    );
  });

  it("create, update and delete hit the list and detail paths", async () => {
    const s = await import("../expense-categories-service");
    mockPost.mockResolvedValue({ data: { id: "c1" } });
    mockPatch.mockResolvedValue({ data: { id: "c1" } });
    mockDelete.mockResolvedValue({});

    await s.createExpenseCategory({ name: "Stationery", code: "STA", ledgerAccountId: "a1" });
    await s.updateExpenseCategory("c1", { isActive: false });
    await s.deleteExpenseCategory("c1");

    expect(mockPost).toHaveBeenCalledWith("/expense-categories", {
      name: "Stationery",
      code: "STA",
      ledger_account: "a1",
    });
    expect(mockPatch).toHaveBeenCalledWith("/expense-categories/c1", { is_active: false });
    expect(mockDelete).toHaveBeenCalledWith("/expense-categories/c1");
  });
});
