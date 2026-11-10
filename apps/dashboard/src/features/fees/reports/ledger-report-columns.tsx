"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";

import { reportColumn as column } from "@/components/reports/report-column";
import { StatusBadge } from "@/features/fees/shared/status-badge";
import {
  EXPENSE_STATUS_BADGE,
  EXPENSE_STATUS_LABEL_KEY,
} from "@/features/fees/shared/expense-labels";
import { LEDGER_ACCOUNT_TYPE_LABEL_KEY } from "@/features/fees/shared/fee-setup-labels";
import { EMPTY_VALUE } from "@/lib/constants";
import { enumLabel } from "@/lib/enum-label";
import { formatDate } from "@/lib/helpers";
import { formatMoney } from "@/lib/format-decimal";
import type { FinanceReportRowOf } from "@/services";
import { userId } from "./report-columns";

/** The columns of the four ledger-side reports, each typed on its kind's row. */
export interface LedgerReportColumns {
  "income-vs-expense": ColumnDef<FinanceReportRowOf<"income-vs-expense">>[];
  "budget-variance": ColumnDef<FinanceReportRowOf<"budget-variance">>[];
  "expense-register": ColumnDef<FinanceReportRowOf<"expense-register">>[];
  "trial-balance": ColumnDef<FinanceReportRowOf<"trial-balance">>[];
}

function money(locale: string, value: string) {
  return <span className="tabular-nums">{formatMoney(locale, value)}</span>;
}

/**
 * The income-vs-expense, budget-variance, expense-register and trial-balance columns. Every
 * figure (net, variance, utilisation, balance) is the server's: the client formats and never sums.
 */
export function useLedgerReportColumns(): LedgerReportColumns {
  const t = useTranslations("fees");
  const locale = useLocale();

  return useMemo<LedgerReportColumns>(() => {
    type Income = FinanceReportRowOf<"income-vs-expense">;
    type Budget = FinanceReportRowOf<"budget-variance">;
    type Expense = FinanceReportRowOf<"expense-register">;
    type Trial = FinanceReportRowOf<"trial-balance">;

    return {
      "income-vs-expense": [
        column<Income>("code", t("reports.columns.code"), (row) => row.code),
        column<Income>("name", t("reports.columns.name"), (row) => row.name),
        column<Income>("type", t("reports.columns.accountType"), (row) =>
          enumLabel(t, LEDGER_ACCOUNT_TYPE_LABEL_KEY, row.account_type),
        ),
        column<Income>("debit", t("reports.columns.totalDebit"), (row) =>
          money(locale, row.total_debit),
        ),
        column<Income>("credit", t("reports.columns.totalCredit"), (row) =>
          money(locale, row.total_credit),
        ),
        column<Income>("net", t("reports.columns.net"), (row) => money(locale, row.net)),
      ],
      "budget-variance": [
        column<Budget>("name", t("reports.columns.budget"), (row) => row.name),
        column<Budget>("period", t("reports.columns.period"), (row) =>
          t("reports.period", {
            start: formatDate(row.period_start, locale),
            end: formatDate(row.period_end, locale),
          }),
        ),
        column<Budget>("budgeted", t("reports.columns.budgeted"), (row) =>
          money(locale, row.budgeted),
        ),
        column<Budget>("actual", t("reports.columns.actual"), (row) => money(locale, row.actual)),
        column<Budget>("variance", t("reports.columns.variance"), (row) =>
          money(locale, row.variance),
        ),
        column<Budget>("utilisation", t("reports.columns.utilisation"), (row) => (
          <span className="tabular-nums">
            {t("reports.percent", { value: formatMoney(locale, row.utilisation_percent) })}
          </span>
        )),
      ],
      "expense-register": [
        column<Expense>("number", t("reports.columns.expenseNo"), (row) => row.expense_no),
        column<Expense>("date", t("reports.columns.date"), (row) =>
          formatDate(row.expense_date, locale),
        ),
        column<Expense>("category", t("reports.columns.category"), (row) => (
          <span className="block">
            <span className="block">{row.category_name}</span>
            <span className="block text-xs text-muted-foreground">{row.category_code}</span>
          </span>
        )),
        column<Expense>(
          "vendor",
          t("reports.columns.vendor"),
          (row) => row.vendor_name ?? EMPTY_VALUE,
        ),
        column<Expense>("description", t("reports.columns.description"), (row) => row.description),
        column<Expense>(
          "campus",
          t("reports.columns.campus"),
          (row) => row.campus_name ?? EMPTY_VALUE,
        ),
        column<Expense>("amount", t("reports.columns.amount"), (row) => money(locale, row.amount)),
        column<Expense>("tax", t("reports.columns.tax"), (row) => money(locale, row.tax_amount)),
        column<Expense>("status", t("reports.columns.status"), (row) => (
          <StatusBadge
            status={row.status}
            labels={EXPENSE_STATUS_LABEL_KEY}
            variants={EXPENSE_STATUS_BADGE}
          />
        )),
        column<Expense>("approvedBy", t("reports.columns.approvedBy"), (row) =>
          row.approved_by ? userId(row.approved_by) : EMPTY_VALUE,
        ),
      ],
      "trial-balance": [
        column<Trial>("code", t("reports.columns.code"), (row) => row.code),
        column<Trial>("name", t("reports.columns.name"), (row) => row.name),
        column<Trial>("type", t("reports.columns.accountType"), (row) =>
          enumLabel(t, LEDGER_ACCOUNT_TYPE_LABEL_KEY, row.account_type),
        ),
        column<Trial>("debit", t("reports.columns.totalDebit"), (row) =>
          money(locale, row.total_debit),
        ),
        column<Trial>("credit", t("reports.columns.totalCredit"), (row) =>
          money(locale, row.total_credit),
        ),
        column<Trial>("balance", t("reports.columns.balance"), (row) => money(locale, row.balance)),
      ],
    };
  }, [t, locale]);
}
