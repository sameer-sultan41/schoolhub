import type { QueryParams } from "@schoolhub/api-client";
import { FILTER_ALL } from "@/lib/constants";
import { rekeyFieldErrors } from "@/lib/error-message";
import { copyMappedFields } from "@/lib/helpers";
import {
  JOURNAL_LINE_FIELDS,
  JOURNAL_MIN_LINES,
  LEDGER_ENTRIES_QUERY_FIELDS,
  LEDGER_REFERENCE_TYPES,
} from "./ledger-entries-constant";
import type { JournalFormValues } from "./ledger-entries.schema";
import type { JournalInput, LedgerReferenceType, LedgerEntriesQuery } from "./ledger-entries-type";

/** The ledger-entries module's pure helpers: plain data in, plain data out. */

/** The list's query string: only the filters given are sent. */
export function toLedgerEntriesQueryParams(query: LedgerEntriesQuery): QueryParams {
  const params: Record<string, unknown> = {};
  copyMappedFields(
    query,
    LEDGER_ENTRIES_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as QueryParams;
}

/** `:post-journal`'s body, in the API's snake_case. */
export function toJournalBody(input: JournalInput): Record<string, unknown> {
  return {
    entry_date: input.entryDate,
    memo: input.memo,
    lines: input.lines.map((line) => ({
      ledger_account: line.ledgerAccountId,
      debit: line.debit,
      credit: line.credit,
    })),
  };
}

/** The reference URL filter -> the API's type (`undefined` for all). */
export function referenceTypeFilter(value: string): LedgerReferenceType | undefined {
  return value === FILTER_ALL ? undefined : LEDGER_REFERENCE_TYPES.find((type) => type === value);
}

/** An entry is reversed once a reversal supersedes it (the one column the ledger ever mutates). */
export function isReversedEntry(entry: { reversed_by_transaction_id: string | null }): boolean {
  return entry.reversed_by_transaction_id !== null;
}

export function defaultJournalFormValues(): JournalFormValues {
  const emptyLine = { ledger_account: "", debit: "", credit: "" };
  return {
    entry_date: "",
    memo: "",
    lines: Array.from({ length: JOURNAL_MIN_LINES }, () => ({ ...emptyLine })),
  };
}

/** Form values -> the service input; a blank side is sent as `0.00` (the API's own default), and which side a line takes is left to the server's check. */
export function buildJournalInput(values: JournalFormValues): JournalInput {
  return {
    entryDate: values.entry_date,
    memo: values.memo.trim(),
    lines: values.lines.map((line) => ({
      ledgerAccountId: line.ledger_account,
      debit: line.debit.trim() || "0.00",
      credit: line.credit.trim() || "0.00",
    })),
  };
}

const AMOUNT_CENTS = /^(\d+)(?:\.(\d{1,2}))?$/;

/** A typed amount as whole cents (an integer, so no float error), or 0 for blank or malformed text (which the server refuses). */
export function amountToCents(value: string): number {
  const match = AMOUNT_CENTS.exec(value.trim());
  if (!match) return 0;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** Whole cents as a decimal string ("1250" -> "12.50"), for the viewer's number format. */
export function centsToDecimal(cents: number): string {
  const whole = Math.trunc(cents / 100);
  return `${whole}.${String(cents - whole * 100).padStart(2, "0")}`;
}

/**
 * The running totals under the lines, as a HINT only: integer cents, never a float sum, and never
 * the gate on Post (the server's own balance check is). A blank or malformed amount counts as 0.
 */
export function journalDifference(lines: readonly { debit: string; credit: string }[]) {
  const debit = lines.reduce((sum, line) => sum + amountToCents(line.debit), 0);
  const credit = lines.reduce((sum, line) => sum + amountToCents(line.credit), 0);
  return { debit, credit, difference: Math.abs(debit - credit), balanced: debit === credit };
}

const LINE_ERROR_FIELD = /^lines\[(\d+)\]\.(\w+)$/;
const LINE_ERROR_ANCHOR = "debit";

/**
 * Re-keys the server's per-line errors (`lines[1].ledger_account`) as the form's own field path
 * (`lines.1.ledger_account`), so the message shows under that line's input. A line's own refusal
 * (`lines[1].non_field_errors`: "exactly one of debit or credit") has no input of its own and
 * shows under the line's Debit. Anything else comes back untouched.
 */
export function mapJournalLineErrors(error: unknown): unknown {
  return rekeyFieldErrors(error, (field) => {
    const match = LINE_ERROR_FIELD.exec(field);
    const index = match?.[1];
    const name = match?.[2];
    if (index === undefined || name === undefined) return undefined;
    const input = JOURNAL_LINE_FIELDS.find((known) => known === name) ?? LINE_ERROR_ANCHOR;
    return `lines.${index}.${input}`;
  });
}
