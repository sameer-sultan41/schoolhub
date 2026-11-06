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
  code: "4000",
  name: "Tuition income",
  accountType: "income" as const,
  parentId: null,
  isActive: true,
};

describe("ledger-accounts-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it("listLedgerAccounts GETs /ledger-accounts as a cursor page with the filters mapped to the API's names", async () => {
    const { listLedgerAccounts } = await import("../ledger-accounts-service");
    mockGet.mockResolvedValue(PAGE);

    const page = await listLedgerAccounts({
      accountType: "income",
      parentId: "p1",
      isActive: false,
      isSystem: true,
      search: "fee",
      ordering: "code",
      cursor: "c1",
      pageSize: 20,
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/ledger-accounts",
      expect.objectContaining({
        query: expect.objectContaining({
          account_type: "income",
          parent_id: "p1",
          is_active: false,
          is_system: true,
          search: "fee",
          ordering: "code",
          cursor: "c1",
          page_size: 20,
        }),
      }),
    );
    expect(page.items).toEqual([{ id: "x1" }]);
  });

  it("listLedgerAccounts sends no filter it was not given", async () => {
    const { listLedgerAccounts } = await import("../ledger-accounts-service");
    mockGet.mockResolvedValue(PAGE);

    await listLedgerAccounts();

    const query = (mockGet.mock.calls[0] as [string, { query: Record<string, unknown> }])[1].query;
    expect(Object.keys(query)).toEqual(["page_size"]);
  });

  it("fetchLedgerAccountOptions reads every matching account in code order, a full page at a time", async () => {
    const { fetchLedgerAccountOptions } = await import("../ledger-accounts-service");
    mockGet.mockResolvedValue(PAGE);

    expect(await fetchLedgerAccountOptions({ accountType: "income", isActive: true })).toEqual([
      { id: "x1" },
    ]);

    expect(mockGet).toHaveBeenCalledWith(
      "/ledger-accounts",
      expect.objectContaining({
        query: expect.objectContaining({
          account_type: "income",
          is_active: true,
          ordering: "code",
          page_size: 100,
        }),
      }),
    );
  });

  it("fetchLedgerAccount GETs /ledger-accounts/{id}", async () => {
    const { fetchLedgerAccount } = await import("../ledger-accounts-service");
    mockGet.mockResolvedValue({ data: { id: "x1" } });

    await expect(fetchLedgerAccount("x1")).resolves.toEqual({ id: "x1" });

    expect(mockGet).toHaveBeenCalledWith("/ledger-accounts/x1");
  });

  it("createLedgerAccount POSTs /ledger-accounts with the snake_case body", async () => {
    const { createLedgerAccount } = await import("../ledger-accounts-service");
    mockPost.mockResolvedValue({ data: { id: "x1" } });

    await createLedgerAccount(INPUT);

    expect(mockPost).toHaveBeenCalledWith("/ledger-accounts", {
      code: "4000",
      name: "Tuition income",
      account_type: "income",
      parent: null,
      is_active: true,
    });
  });

  it("updateLedgerAccount PATCHes /ledger-accounts/{id} with only the fields given", async () => {
    const { updateLedgerAccount } = await import("../ledger-accounts-service");
    mockPatch.mockResolvedValue({ data: { id: "x1" } });

    await updateLedgerAccount("x1", { name: "Renamed" });

    expect(mockPatch).toHaveBeenCalledWith("/ledger-accounts/x1", { name: "Renamed" });
  });

  it("deleteLedgerAccount DELETEs /ledger-accounts/{id}", async () => {
    const { deleteLedgerAccount } = await import("../ledger-accounts-service");
    mockDelete.mockResolvedValue({});

    await deleteLedgerAccount("x1");

    expect(mockDelete).toHaveBeenCalledWith("/ledger-accounts/x1");
  });
});
