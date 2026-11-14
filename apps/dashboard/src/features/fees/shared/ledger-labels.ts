import type { LedgerReferenceType } from "@/services";

/**
 * A ledger entry's reference type and its standing: message keys in the `fees` namespace, and the
 * standing's badge variant. Exhaustive records (L32): a value the generated enum gains fails to
 * compile here until it is labelled.
 */

export const LEDGER_REFERENCE_LABEL_KEY: Record<LedgerReferenceType, string> = {
  payment: "ledger.journal.reference.payment",
  refund: "ledger.journal.reference.refund",
  expense: "ledger.journal.reference.expense",
  payroll_run: "ledger.journal.reference.payroll_run",
  fine: "ledger.journal.reference.fine",
  manual: "ledger.journal.reference.manual",
  reversal: "ledger.journal.reference.reversal",
};

/** An entry still stands, or a reversal has superseded it (both stay in the ledger). */
export type LedgerEntryState = "posted" | "reversed";

export const LEDGER_ENTRY_STATE_LABEL_KEY: Record<LedgerEntryState, string> = {
  posted: "ledger.journal.state.posted",
  reversed: "ledger.journal.state.reversed",
};

export const LEDGER_ENTRY_STATE_BADGE: Record<
  LedgerEntryState,
  "primary" | "success" | "warning" | "destructive" | "secondary"
> = {
  posted: "success",
  reversed: "secondary",
};
