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

const EMPTY_PAGE = {
  data: [],
  meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
};

describe("expenses-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  it("listExpenses sends the filters under the API's names and omits awaiting_approval when off", async () => {
    const { listExpenses } = await import("../expenses-service");
    mockGet.mockResolvedValue(EMPTY_PAGE);

    await listExpenses({ status: "submitted", awaitingApproval: true, dateFrom: "2026-01-01" });
    await listExpenses({ awaitingApproval: false });

    expect(mockGet).toHaveBeenNthCalledWith(
      1,
      "/expenses",
      expect.objectContaining({
        query: {
          status: "submitted",
          awaiting_approval: true,
          expense_date__gte: "2026-01-01",
          page_size: 25,
        },
      }),
    );
    expect(mockGet).toHaveBeenNthCalledWith(
      2,
      "/expenses",
      expect.objectContaining({ query: { page_size: 25 } }),
    );
  });

  it("createExpense POSTs the snake_case body; updateExpense PATCHes only the fields given", async () => {
    const { createExpense, updateExpense } = await import("../expenses-service");
    mockPost.mockResolvedValue({ data: { id: "e1" } });
    mockPatch.mockResolvedValue({ data: { id: "e1" } });

    await createExpense({
      expenseCategoryId: "c1",
      description: "Chalk",
      amount: "10.00",
      expenseDate: "2026-02-01",
      campusId: null,
    });
    await updateExpense("e1", { amount: "12.00" });

    expect(mockPost).toHaveBeenCalledWith("/expenses", {
      expense_category: "c1",
      description: "Chalk",
      amount: "10.00",
      expense_date: "2026-02-01",
      campus: null,
    });
    expect(mockPatch).toHaveBeenCalledWith("/expenses/e1", { amount: "12.00" });
  });

  it("each transition POSTs its colon-action, and reverse carries the reason", async () => {
    const s = await import("../expenses-service");
    mockPost.mockResolvedValue({ data: { id: "e1" } });

    await s.submitExpense("e1");
    await s.approveExpense("e1");
    await s.rejectExpense("e1");
    await s.markExpensePaid("e1");
    await s.reverseExpense("e1", "Duplicate");

    expect(mockPost.mock.calls.map(([path]: [string]) => path)).toEqual([
      "/expenses/e1:submit",
      "/expenses/e1:approve",
      "/expenses/e1:reject",
      "/expenses/e1:mark-paid",
      "/expenses/e1:reverse",
    ]);
    expect(mockPost).toHaveBeenLastCalledWith("/expenses/e1:reverse", { reason: "Duplicate" });
  });
});
