import { toFeeHeadBody, toFeeHeadsQueryParams } from "../fee-heads-helper";

describe("toFeeHeadsQueryParams", () => {
  it("maps every filter to the API's name", () => {
    expect(
      toFeeHeadsQueryParams({
        category: "tuition",
        ledgerAccountId: "l1",
        isActive: true,
        isRefundable: false,
        search: "tu",
        cursor: "c1",
        pageSize: 20,
      }),
    ).toEqual({
      category: "tuition",
      ledger_account_id: "l1",
      is_active: true,
      is_refundable: false,
      search: "tu",
      cursor: "c1",
      page_size: 20,
    });
  });

  it("drops undefined and empty filters", () => {
    expect(toFeeHeadsQueryParams({ search: "", ordering: undefined })).toEqual({});
  });
});

describe("toFeeHeadBody", () => {
  it("maps the input to the snake_case body", () => {
    expect(
      toFeeHeadBody({
        name: "Tuition",
        code: "TUI",
        category: "tuition" as const,
        ledgerAccountId: "l1",
        isRefundable: false,
        isActive: true,
      }),
    ).toEqual({
      name: "Tuition",
      code: "TUI",
      category: "tuition",
      ledger_account: "l1",
      is_refundable: false,
      is_active: true,
    });
  });

  it("sends nothing for an empty input", () => {
    expect(toFeeHeadBody({})).toEqual({});
  });
});
