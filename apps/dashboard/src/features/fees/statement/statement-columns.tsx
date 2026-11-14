"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";

import { reportColumn as column } from "@/components/reports/report-column";
import { STATEMENT_ENTRY_LABEL_KEY } from "@/features/fees/reports/report-labels";
import { EMPTY_VALUE } from "@/lib/constants";
import { enumLabel } from "@/lib/enum-label";
import { formatMoney } from "@/lib/format-decimal";
import { formatDate } from "@/lib/helpers";
import type { StudentStatementEntry } from "@/services";

function money(locale: string, value: string) {
  return <span className="tabular-nums">{formatMoney(locale, value)}</span>;
}

/**
 * A student statement's columns. The running balance is the server's, line by line: the client
 * formats it and never recomputes it from the debits and credits.
 */
export function useStatementColumns(): ColumnDef<StudentStatementEntry>[] {
  const t = useTranslations("fees");
  const locale = useLocale();

  return useMemo<ColumnDef<StudentStatementEntry>[]>(
    () => [
      column<StudentStatementEntry>("date", t("reports.columns.date"), (row) =>
        row.date ? formatDate(row.date, locale) : EMPTY_VALUE,
      ),
      column<StudentStatementEntry>("type", t("reports.columns.type"), (row) =>
        enumLabel(t, STATEMENT_ENTRY_LABEL_KEY, row.kind),
      ),
      column<StudentStatementEntry>("reference", t("reports.columns.reference"), (row) =>
        row.reference === "" ? EMPTY_VALUE : row.reference,
      ),
      column<StudentStatementEntry>(
        "description",
        t("reports.columns.description"),
        (row) => row.description,
      ),
      column<StudentStatementEntry>("debit", t("reports.columns.debit"), (row) =>
        money(locale, row.debit),
      ),
      column<StudentStatementEntry>("credit", t("reports.columns.credit"), (row) =>
        money(locale, row.credit),
      ),
      column<StudentStatementEntry>("balance", t("reports.columns.balance"), (row) =>
        money(locale, row.balance),
      ),
    ],
    [t, locale],
  );
}
