import {
  settlementExceptions,
  settlementJobCounts,
  settlementProviderFilter,
  settlementStatusFilter,
  toSettlementImportsQueryParams,
  toSettlementUploadBody,
} from "../settlement-imports-helper";

describe("settlementExceptions", () => {
  it("reads the server's row shape", () => {
    expect(
      settlementExceptions([
        { row: 3, provider_reference: "TXN-77", amount: "900.00", reason: "No open voucher." },
      ]),
    ).toEqual([
      { row: 3, providerReference: "TXN-77", amount: "900.00", reason: "No open voucher." },
    ]);
  });

  it("drops an entry with no reason and tolerates anything that is not a list", () => {
    expect(settlementExceptions([{ row: 1 }, "text", null, { row: 2, reason: "Bad" }])).toEqual([
      { row: 2, providerReference: "", amount: "", reason: "Bad" },
    ]);
    expect(settlementExceptions(null)).toEqual([]);
    expect(settlementExceptions({ row: 1, reason: "x" })).toEqual([]);
  });
});

describe("settlementJobCounts", () => {
  it("reads the job result's own counts, zeros when it carries none", () => {
    expect(settlementJobCounts({ row_count: 4, matched: 3, exceptions: 1 })).toEqual({
      rowCount: 4,
      matched: 3,
      exceptions: 1,
    });
    expect(settlementJobCounts(null)).toEqual({ rowCount: 0, matched: 0, exceptions: 0 });
  });
});

describe("settlement-imports-helper", () => {
  it("builds the multipart body the contract names: file and provider", () => {
    const file = new File(["x"], "s.csv", { type: "text/csv" });
    const body = toSettlementUploadBody(file, "easypaisa");

    expect(body.get("file")).toBe(file);
    expect(body.get("provider")).toBe("easypaisa");
  });

  it("sends only the filters given", () => {
    expect(toSettlementImportsQueryParams({ provider: "jazzcash", pageSize: 25 })).toEqual({
      provider: "jazzcash",
      page_size: 25,
    });
  });

  it("reads filters as the API's, or nothing for all and for a stranger", () => {
    expect(settlementStatusFilter("failed")).toBe("failed");
    expect(settlementStatusFilter("all")).toBeUndefined();
    expect(settlementProviderFilter("bank_branch")).toBe("bank_branch");
    expect(settlementProviderFilter("paypal")).toBeUndefined();
  });
});
