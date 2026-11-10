import type { FinanceReportRow, FinanceReportRowOf } from "../finance-reports-type";

/**
 * One row per kind in the exact shape `GET /reports/finance-summary` sends (the typed row
 * serializers in `apps/api/apps/fees_finance/report_serializers.py`): money as two-decimal
 * strings, `kind` as the discriminator, a statement line's and a grant's own type under
 * `entry_type` and `grant_type`, and a collection row carrying all three grouping keys (null for
 * the two it was not grouped by).
 */

export const STUDENT_ID = "11111111-1111-4111-8111-111111111111";
export const CASHIER_ID = "22222222-2222-4222-8222-222222222222";
export const ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";

export const COLLECTION_DAY: FinanceReportRowOf<"collection"> = {
  kind: "collection",
  day: "2026-10-01",
  method: null,
  received_by: null,
  total: "1500.00",
  count: 3,
};
export const COLLECTION_METHOD: FinanceReportRowOf<"collection"> = {
  kind: "collection",
  day: null,
  method: "bank_transfer",
  received_by: null,
  total: "900.50",
  count: 2,
};
export const COLLECTION_CASHIER: FinanceReportRowOf<"collection"> = {
  kind: "collection",
  day: null,
  method: null,
  received_by: CASHIER_ID,
  total: "2400.50",
  count: 5,
};

export const AGING: FinanceReportRowOf<"outstanding-aging"> = {
  kind: "outstanding-aging",
  student_id: STUDENT_ID,
  admission_number: "ADM-1001",
  first_name: "Aisha",
  last_name: "Khan",
  total_outstanding: "4000.00",
  invoice_count: 4,
  not_yet_due: "1000.00",
  bucket_0_30: "500.00",
  bucket_31_60: "750.25",
  bucket_61_90: "1249.75",
  bucket_90_plus: "500.00",
};

export const LEDGER_INVOICE: FinanceReportRowOf<"student-ledger"> = {
  kind: "student-ledger",
  entry_type: "invoice",
  date: "2026-08-01",
  reference: "INV-0001",
  description: "2026-09",
  debit: "1000.00",
  credit: "0.00",
  balance: "1000.00",
};
export const LEDGER_PAYMENT: FinanceReportRowOf<"student-ledger"> = {
  kind: "student-ledger",
  entry_type: "payment",
  date: "2026-10-01",
  reference: "RCP-0007",
  description: "Cash",
  debit: "0.00",
  credit: "400.00",
  balance: "600.00",
};

export const GRANT: FinanceReportRowOf<"grant-register"> = {
  kind: "grant-register",
  id: "44444444-4444-4444-8444-444444444444",
  grant_type: "scholarship",
  name: "Merit award",
  value_type: "percent",
  value: "25.00",
  status: "active",
  approved_by: CASHIER_ID,
  admission_number: "ADM-1001",
  granted_at: "2026-09-02T08:30:00Z",
};
export const WAIVED_FINE: FinanceReportRowOf<"grant-register"> = {
  kind: "grant-register",
  id: "55555555-5555-4555-8555-555555555555",
  grant_type: "fine_waiver",
  name: "library",
  value_type: "fixed",
  value: "250.00",
  status: "waived",
  approved_by: CASHIER_ID,
  admission_number: "ADM-1002",
  granted_at: "2026-09-03T08:30:00Z",
};

export const INCOME_VS_EXPENSE: FinanceReportRowOf<"income-vs-expense"> = {
  kind: "income-vs-expense",
  ledger_account_id: ACCOUNT_ID,
  account_type: "income",
  total_debit: "0.00",
  total_credit: "50000.00",
  code: "4000",
  name: "Fee income",
  net: "50000.00",
};

export const BUDGET: FinanceReportRowOf<"budget-variance"> = {
  kind: "budget-variance",
  budget_id: "66666666-6666-4666-8666-666666666666",
  name: "Utilities Q4",
  period_start: "2026-10-01",
  period_end: "2026-12-31",
  budgeted: "100000.00",
  actual: "62500.00",
  variance: "37500.00",
  utilisation_percent: "62.50",
};

export const EXPENSE: FinanceReportRowOf<"expense-register"> = {
  kind: "expense-register",
  id: "77777777-7777-4777-8777-777777777777",
  expense_no: "EXP-0001",
  expense_date: "2026-10-05",
  vendor_name: "City Power",
  description: "Electricity bill",
  amount: "5000.00",
  tax_amount: "250.00",
  status: "approved",
  approved_by: CASHIER_ID,
  category_code: "UTIL",
  category_name: "Utilities",
  campus_name: null,
};

export const TRIAL_BALANCE: FinanceReportRowOf<"trial-balance"> = {
  kind: "trial-balance",
  ledger_account_id: ACCOUNT_ID,
  account_type: "income",
  total_debit: "100.00",
  total_credit: "50100.00",
  code: "4000",
  name: "Fee income",
  balance: "-50000.00",
};

/** Every kind's rows, as `fetchReport` returns them. */
export const ROWS_BY_KIND: Record<FinanceReportRow["kind"], FinanceReportRow[]> = {
  collection: [COLLECTION_DAY],
  "outstanding-aging": [AGING],
  "student-ledger": [LEDGER_INVOICE, LEDGER_PAYMENT],
  "grant-register": [GRANT, WAIVED_FINE],
  "income-vs-expense": [INCOME_VS_EXPENSE],
  "budget-variance": [BUDGET],
  "expense-register": [EXPENSE],
  "trial-balance": [TRIAL_BALANCE],
};
