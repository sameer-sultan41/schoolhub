import { ApiError } from "@schoolhub/api-client";

import {
  amountToCents,
  buildJournalInput,
  centsToDecimal,
  defaultJournalFormValues,
  isReversedEntry,
  journalDifference,
  mapJournalLineErrors,
  referenceTypeFilter,
} from "../ledger-entries-helper";
import { LEDGER_ENTRIES_URL_FILTERS } from "../ledger-entries-constant";

describe("journalDifference", () => {
  it("sums in whole cents, so 0.1 + 0.2 against 0.30 balances", () => {
    const result = journalDifference([
      { debit: "0.10", credit: "" },
      { debit: "0.2", credit: "" },
      { debit: "", credit: "0.30" },
    ]);
    expect(result).toMatchObject({ debit: 30, credit: 30, difference: 0, balanced: true });
  });

  it("reports the gap, and counts a blank or malformed amount as nothing", () => {
    const result = journalDifference([
      { debit: "100.00", credit: "" },
      { debit: "abc", credit: "40.5" },
    ]);
    expect(result).toMatchObject({ debit: 10000, credit: 4050, difference: 5950, balanced: false });
    expect(centsToDecimal(result.difference)).toBe("59.50");
  });
});

describe("amount helpers", () => {
  it("reads cents from one or two decimals and refuses anything else", () => {
    expect(amountToCents("12")).toBe(1200);
    expect(amountToCents("12.5")).toBe(1250);
    expect(amountToCents("12.05")).toBe(1205);
    expect(amountToCents("12.345")).toBe(0);
    expect(amountToCents("-1")).toBe(0);
    expect(centsToDecimal(5)).toBe("0.05");
  });
});

describe("buildJournalInput", () => {
  it("trims the memo and sends a blank side as 0.00", () => {
    const input = buildJournalInput({
      entry_date: "2026-10-05",
      memo: " Fix ",
      lines: [
        { ledger_account: "a1", debit: " 50.00 ", credit: "" },
        { ledger_account: "a2", debit: "", credit: "50.00" },
      ],
    });
    expect(input).toEqual({
      entryDate: "2026-10-05",
      memo: "Fix",
      lines: [
        { ledgerAccountId: "a1", debit: "50.00", credit: "0.00" },
        { ledgerAccountId: "a2", debit: "0.00", credit: "50.00" },
      ],
    });
  });

  it("starts with two empty lines, the least a posting has", () => {
    expect(defaultJournalFormValues().lines).toHaveLength(2);
  });
});

describe("filters and state", () => {
  it("maps the reference filter to a known type only", () => {
    expect(referenceTypeFilter("all")).toBeUndefined();
    expect(referenceTypeFilter("expense")).toBe("expense");
    expect(referenceTypeFilter("bogus")).toBeUndefined();
  });

  it("marks an entry reversed once a reversal supersedes it", () => {
    expect(isReversedEntry({ reversed_by_transaction_id: null })).toBe(false);
    expect(isReversedEntry({ reversed_by_transaction_id: "t1" })).toBe(true);
  });
});

describe("mapJournalLineErrors", () => {
  const refused = (field: string) =>
    new ApiError({
      status: 400,
      code: "validation_error",
      message: "x",
      url: "/ledger-entries:post-journal",
      details: [{ field, issue: "issue" }],
    });

  it("re-keys a line's field error as the form's path", () => {
    const mapped = mapJournalLineErrors(refused("lines[1].ledger_account"));
    expect((mapped as ApiError).fieldErrors()).toEqual({ "lines.1.ledger_account": "issue" });
  });

  it("puts a line's own refusal under its Debit", () => {
    const mapped = mapJournalLineErrors(refused("lines[0].non_field_errors"));
    expect((mapped as ApiError).fieldErrors()).toEqual({ "lines.0.debit": "issue" });
  });

  it("leaves any other error as it came", () => {
    const error = refused("non_field");
    expect(mapJournalLineErrors(error)).toBe(error);
    const other = new Error("x");
    expect(mapJournalLineErrors(other)).toBe(other);
  });
});

describe("ledger entries URL filters", () => {
  it("keeps the account only when it is a UUID (or blank)", () => {
    const { account } = LEDGER_ENTRIES_URL_FILTERS;
    expect(account.isValid("")).toBe(true);
    expect(account.isValid("55555555-5555-4555-8555-555555555555")).toBe(true);
    expect(account.isValid("abc")).toBe(false);
  });
});
