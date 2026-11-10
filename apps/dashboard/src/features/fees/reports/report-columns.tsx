"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";

import { reportColumn as column } from "@/components/reports/report-column";
import { StatusBadge } from "@/features/fees/shared/status-badge";
import { EMPTY_VALUE } from "@/lib/constants";
import { enumLabel } from "@/lib/enum-label";
import { formatDate } from "@/lib/helpers";
import { formatMoney } from "@/lib/format-decimal";
import type { FinanceReportGroupBy, FinanceReportRowOf } from "@/services";
import { GRANT_VALUE_TYPE_LABEL_KEY } from "@/features/fees/shared/grant-labels";
import { PAYMENT_METHOD_LABEL_KEY } from "@/features/fees/shared/payment-labels";
import {
  GRANT_ROW_STATUS_BADGE,
  GRANT_ROW_STATUS_LABEL_KEY,
  GRANT_TYPE_LABEL_KEY,
  STATEMENT_ENTRY_LABEL_KEY,
} from "./report-labels";

/** The columns of the four student-facing reports, each typed on its kind's row. */
export interface StudentReportColumns {
  collection: ColumnDef<FinanceReportRowOf<"collection">>[];
  "outstanding-aging": ColumnDef<FinanceReportRowOf<"outstanding-aging">>[];
  "student-ledger": ColumnDef<FinanceReportRowOf<"student-ledger">>[];
  "grant-register": ColumnDef<FinanceReportRowOf<"grant-register">>[];
}

/** Characters of a user's id shown: a report names a cashier or approver by id, and the fees
 * screens have no read path that gives a name. The full id is the cell's title. */
const USER_ID_PREFIX_LENGTH = 8;

export function userId(id: string) {
  return (
    <span className="font-mono text-xs" title={id}>
      {id.slice(0, USER_ID_PREFIX_LENGTH)}
    </span>
  );
}

/** An amount, aligned for scanning down a column. */
function money(locale: string, value: string) {
  return <span className="tabular-nums">{formatMoney(locale, value)}</span>;
}

/**
 * The collection, aging, statement and grant-register columns. Each cell reads only the fields its
 * report sends, and every amount is the server's string, formatted for display and never summed.
 * The collection's first column follows how it was grouped.
 */
export function useStudentReportColumns(groupBy: FinanceReportGroupBy): StudentReportColumns {
  const t = useTranslations("fees");
  const locale = useLocale();

  return useMemo<StudentReportColumns>(() => {
    type Collection = FinanceReportRowOf<"collection">;
    type Aging = FinanceReportRowOf<"outstanding-aging">;
    type Ledger = FinanceReportRowOf<"student-ledger">;
    type Grant = FinanceReportRowOf<"grant-register">;

    const groupColumn: Record<FinanceReportGroupBy, ColumnDef<Collection>> = {
      day: column<Collection>("day", t("reports.columns.day"), (row) =>
        row.day ? formatDate(row.day, locale) : EMPTY_VALUE,
      ),
      method: column<Collection>("method", t("reports.columns.method"), (row) =>
        row.method ? enumLabel(t, PAYMENT_METHOD_LABEL_KEY, row.method) : EMPTY_VALUE,
      ),
      cashier: column<Collection>("cashier", t("reports.columns.cashier"), (row) =>
        row.received_by ? userId(row.received_by) : t("reports.columns.noCashier"),
      ),
    };

    return {
      collection: [
        groupColumn[groupBy],
        column<Collection>("total", t("reports.columns.total"), (row) => money(locale, row.total)),
        column<Collection>("count", t("reports.columns.payments"), (row) => row.count),
      ],
      "outstanding-aging": [
        column<Aging>("student", t("reports.columns.student"), (row) => (
          <span className="block">
            <span className="block">
              {t("reports.fullName", { first: row.first_name, last: row.last_name })}
            </span>
            <span className="block text-xs text-muted-foreground">{row.admission_number}</span>
          </span>
        )),
        column<Aging>("total", t("reports.columns.totalOutstanding"), (row) =>
          money(locale, row.total_outstanding),
        ),
        column<Aging>("invoices", t("reports.columns.invoices"), (row) => row.invoice_count),
        column<Aging>("notYetDue", t("reports.columns.notYetDue"), (row) =>
          money(locale, row.not_yet_due),
        ),
        column<Aging>("b0", t("reports.columns.bucket0to30"), (row) =>
          money(locale, row.bucket_0_30),
        ),
        column<Aging>("b31", t("reports.columns.bucket31to60"), (row) =>
          money(locale, row.bucket_31_60),
        ),
        column<Aging>("b61", t("reports.columns.bucket61to90"), (row) =>
          money(locale, row.bucket_61_90),
        ),
        column<Aging>("b90", t("reports.columns.bucket90plus"), (row) =>
          money(locale, row.bucket_90_plus),
        ),
      ],
      "student-ledger": [
        column<Ledger>("date", t("reports.columns.date"), (row) =>
          row.date ? formatDate(row.date, locale) : EMPTY_VALUE,
        ),
        column<Ledger>("type", t("reports.columns.type"), (row) =>
          enumLabel(t, STATEMENT_ENTRY_LABEL_KEY, row.entry_type),
        ),
        column<Ledger>("reference", t("reports.columns.reference"), (row) =>
          row.reference === "" ? EMPTY_VALUE : row.reference,
        ),
        column<Ledger>("description", t("reports.columns.description"), (row) => row.description),
        column<Ledger>("debit", t("reports.columns.debit"), (row) => money(locale, row.debit)),
        column<Ledger>("credit", t("reports.columns.credit"), (row) => money(locale, row.credit)),
        column<Ledger>("balance", t("reports.columns.balance"), (row) =>
          money(locale, row.balance),
        ),
      ],
      "grant-register": [
        column<Grant>("type", t("reports.columns.grant"), (row) =>
          enumLabel(t, GRANT_TYPE_LABEL_KEY, row.grant_type),
        ),
        column<Grant>("name", t("reports.columns.name"), (row) => row.name),
        column<Grant>(
          "admission",
          t("reports.columns.admissionNumber"),
          (row) => row.admission_number,
        ),
        column<Grant>("value", t("reports.columns.value"), (row) => (
          <span className="tabular-nums">
            {formatMoney(locale, row.value)} (
            {enumLabel(t, GRANT_VALUE_TYPE_LABEL_KEY, row.value_type)})
          </span>
        )),
        column<Grant>("status", t("reports.columns.status"), (row) => (
          <StatusBadge
            status={row.status}
            labels={GRANT_ROW_STATUS_LABEL_KEY}
            variants={GRANT_ROW_STATUS_BADGE}
          />
        )),
        column<Grant>("approvedBy", t("reports.columns.approvedBy"), (row) =>
          row.approved_by ? userId(row.approved_by) : EMPTY_VALUE,
        ),
        column<Grant>("grantedAt", t("reports.columns.grantedOn"), (row) =>
          formatDate(row.granted_at, locale),
        ),
      ],
    };
  }, [t, locale, groupBy]);
}
