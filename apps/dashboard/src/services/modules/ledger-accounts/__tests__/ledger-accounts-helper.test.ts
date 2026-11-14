import { toLedgerAccountBody, toLedgerAccountsQueryParams } from "../ledger-accounts-helper";

describe("toLedgerAccountsQueryParams", () => {
  it("maps every filter to the API's name", () => {
    expect(
      toLedgerAccountsQueryParams({
        accountType: "income",
        parentId: "p1",
        isActive: false,
        isSystem: true,
        search: "fee",
        ordering: "code",
        cursor: "c1",
        pageSize: 20,
      }),
    ).toEqual({
      account_type: "income",
      parent_id: "p1",
      is_active: false,
      is_system: true,
      search: "fee",
      ordering: "code",
      cursor: "c1",
      page_size: 20,
    });
  });

  it("drops undefined and empty filters", () => {
    expect(toLedgerAccountsQueryParams({ search: "", ordering: undefined })).toEqual({});
  });
});

describe("toLedgerAccountBody", () => {
  it("maps the input to the snake_case body", () => {
    expect(
      toLedgerAccountBody({
        code: "4000",
        name: "Tuition income",
        accountType: "income" as const,
        parentId: null,
        isActive: true,
      }),
    ).toEqual({
      code: "4000",
      name: "Tuition income",
      account_type: "income",
      parent: null,
      is_active: true,
    });
  });

  it("sends nothing for an empty input", () => {
    expect(toLedgerAccountBody({})).toEqual({});
  });
});
