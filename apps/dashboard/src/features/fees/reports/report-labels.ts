import type { FinanceReportGroupBy, FinanceReportKind, FinanceReportRowOf } from "@/services";
import {
  DISCOUNT_STATUS_BADGE,
  DISCOUNT_STATUS_LABEL_KEY,
  FINE_STATUS_BADGE,
  FINE_STATUS_LABEL_KEY,
  SCHOLARSHIP_STATUS_BADGE,
  SCHOLARSHIP_STATUS_LABEL_KEY,
} from "@/features/fees/shared/grant-labels";

/**
 * The finance reports' enums as message keys in the `fees` namespace. Exhaustive records (L32): a
 * value the generated enum gains fails to compile here until it is labelled.
 */

export const REPORT_KIND_LABEL_KEY: Record<FinanceReportKind, string> = {
  collection: "reports.kinds.collection",
  "outstanding-aging": "reports.kinds.outstanding-aging",
  "student-ledger": "reports.kinds.student-ledger",
  "grant-register": "reports.kinds.grant-register",
  "income-vs-expense": "reports.kinds.income-vs-expense",
  "budget-variance": "reports.kinds.budget-variance",
  "expense-register": "reports.kinds.expense-register",
  "trial-balance": "reports.kinds.trial-balance",
};

export const REPORT_GROUPING_LABEL_KEY: Record<FinanceReportGroupBy, string> = {
  day: "reports.grouping.day",
  method: "reports.grouping.method",
  cashier: "reports.grouping.cashier",
};

/** A statement line's type (`entry_type`: the row's own `kind` is the discriminator). */
export const STATEMENT_ENTRY_LABEL_KEY: Record<
  FinanceReportRowOf<"student-ledger">["entry_type"],
  string
> = {
  invoice: "reports.entryType.invoice",
  payment: "reports.entryType.payment",
  refund: "reports.entryType.refund",
};

/** What a register row is (`grant_type`). */
export const GRANT_TYPE_LABEL_KEY: Record<
  FinanceReportRowOf<"grant-register">["grant_type"],
  string
> = {
  discount: "reports.grantType.discount",
  scholarship: "reports.grantType.scholarship",
  fine_waiver: "reports.grantType.fine_waiver",
};

type BadgeVariant = "primary" | "success" | "warning" | "destructive" | "secondary";

/**
 * A register row's `status` is its source's own (a discount's, a scholarship's or a waived
 * fine's), so the row types it as a string. The three sources' maps, merged: where two share a
 * value ("active", "revoked") they mean the same, and an unknown one is humanised (`enumLabel`).
 */
export const GRANT_ROW_STATUS_LABEL_KEY: Record<string, string> = {
  ...DISCOUNT_STATUS_LABEL_KEY,
  ...SCHOLARSHIP_STATUS_LABEL_KEY,
  ...FINE_STATUS_LABEL_KEY,
};
export const GRANT_ROW_STATUS_BADGE: Record<string, BadgeVariant> = {
  ...DISCOUNT_STATUS_BADGE,
  ...SCHOLARSHIP_STATUS_BADGE,
  ...FINE_STATUS_BADGE,
};
