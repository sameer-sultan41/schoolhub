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

const EMPTY_PAGE = {
  data: [],
  meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
};

describe("ledger-entries-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("listLedgerEntries sends the filters under the API's names, the dates as plain days", async () => {
    const { listLedgerEntries } = await import("../ledger-entries-service");
    mockGet.mockResolvedValue(EMPTY_PAGE);

    await listLedgerEntries({
      accountId: "a1",
      referenceType: "manual",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      search: "",
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/ledger-entries",
      expect.objectContaining({
        query: {
          account: "a1",
          reference_type: "manual",
          date__gte: "2026-10-01",
          date__lte: "2026-10-31",
          page_size: 25,
        },
      }),
    );
  });

  it("postJournal POSTs the snake_case body to the colon-action with the Idempotency-Key", async () => {
    const { postJournal } = await import("../ledger-entries-service");
    mockPost.mockResolvedValue({ data: [{ id: "l1" }] });

    const lines = await postJournal(
      {
        entryDate: "2026-10-05",
        memo: "Correct the fee posting",
        lines: [
          { ledgerAccountId: "a1", debit: "50.00", credit: "0.00" },
          { ledgerAccountId: "a2", debit: "0.00", credit: "50.00" },
        ],
      },
      "key-1",
    );

    expect(lines).toEqual([{ id: "l1" }]);
    expect(mockPost).toHaveBeenCalledWith(
      "/ledger-entries:post-journal",
      {
        entry_date: "2026-10-05",
        memo: "Correct the fee posting",
        lines: [
          { ledger_account: "a1", debit: "50.00", credit: "0.00" },
          { ledger_account: "a2", debit: "0.00", credit: "50.00" },
        ],
      },
      { idempotencyKey: "key-1" },
    );
  });
});
