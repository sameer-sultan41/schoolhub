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

describe("budgets-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  it("listBudgets sends the filters under the API's names", async () => {
    const { listBudgets } = await import("../budgets-service");
    mockGet.mockResolvedValue({
      data: [],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
    });

    await listBudgets({ status: "draft", expenseCategoryId: "c1" });

    expect(mockGet).toHaveBeenCalledWith(
      "/budgets",
      expect.objectContaining({
        query: { status: "draft", expense_category_id: "c1", page_size: 25 },
      }),
    );
  });

  it("create, update and approve hit their paths with the snake_case body", async () => {
    const s = await import("../budgets-service");
    mockPost.mockResolvedValue({ data: { id: "b1" } });
    mockPatch.mockResolvedValue({ data: { id: "b1" } });

    await s.createBudget({
      name: "Q1",
      expenseCategoryId: "c1",
      ledgerAccountId: null,
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
      amount: "500.00",
    });
    await s.updateBudget("b1", { amount: "600.00" });
    await s.approveBudget("b1");

    expect(mockPost).toHaveBeenNthCalledWith(1, "/budgets", {
      name: "Q1",
      expense_category: "c1",
      ledger_account: null,
      period_start: "2026-01-01",
      period_end: "2026-03-31",
      amount: "500.00",
    });
    expect(mockPatch).toHaveBeenCalledWith("/budgets/b1", { amount: "600.00" });
    expect(mockPost).toHaveBeenNthCalledWith(2, "/budgets/b1:approve");
  });
});
