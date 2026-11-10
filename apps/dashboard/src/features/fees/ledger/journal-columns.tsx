"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { EMPTY_VALUE } from "@/lib/constants";
import { enumLabel } from "@/lib/enum-label";
import { formatMoney } from "@/lib/format-decimal";
import { formatDate } from "@/lib/helpers";
import type { LedgerEntryRecord } from "@/services";
import { isReversedEntry } from "@/services/modules/ledger-entries/ledger-entries-helper";
import {
  LEDGER_ENTRY_STATE_BADGE,
  LEDGER_ENTRY_STATE_LABEL_KEY,
  LEDGER_REFERENCE_LABEL_KEY,
} from "@/features/fees/shared/ledger-labels";
import { StatusBadge } from "@/features/fees/shared/status-badge";

/**
 * The journal's columns; `entry_date` is the sortable id. A row is one line of a posting: its
 * account arrives named on the entry (`account_code`, `account_name`), so no lookup is needed.
 * A zero side shows blank, so the eye finds the amount; a reversed entry carries a badge.
 */
export function useJournalColumns(): ColumnDef<LedgerEntryRecord>[] {
  const t = useTranslations("fees");
  const locale = useLocale();

  return useMemo<ColumnDef<LedgerEntryRecord>[]>(() => {
    const amount = (value: string) =>
      Number(value) === 0 ? EMPTY_VALUE : formatMoney(locale, value);
    return [
      {
        id: "entry_date",
        accessorKey: "entry_date",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("ledger.journal.columns.date")} />
        ),
        cell: ({ row }) => formatDate(row.original.entry_date, locale),
        meta: {
          headerTitle: t("ledger.journal.columns.date"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "account",
        enableSorting: false,
        header: () => t("ledger.journal.columns.account"),
        cell: ({ row }) => (
          <span className="font-medium text-foreground">
            {row.original.account_code} {row.original.account_name}
          </span>
        ),
        meta: {
          headerTitle: t("ledger.journal.columns.account"),
          skeleton: <Skeleton className="h-4 w-40" />,
        },
      },
      {
        id: "memo",
        enableSorting: false,
        header: () => t("ledger.journal.columns.memo"),
        cell: ({ row }) => row.original.memo || EMPTY_VALUE,
        meta: {
          headerTitle: t("ledger.journal.columns.memo"),
          skeleton: <Skeleton className="h-4 w-48" />,
        },
      },
      {
        id: "debit",
        enableSorting: false,
        header: () => t("ledger.journal.columns.debit"),
        cell: ({ row }) => <span className="tabular-nums">{amount(row.original.debit)}</span>,
        meta: {
          headerTitle: t("ledger.journal.columns.debit"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "credit",
        enableSorting: false,
        header: () => t("ledger.journal.columns.credit"),
        cell: ({ row }) => <span className="tabular-nums">{amount(row.original.credit)}</span>,
        meta: {
          headerTitle: t("ledger.journal.columns.credit"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "reference",
        enableSorting: false,
        header: () => t("ledger.journal.columns.reference"),
        cell: ({ row }) => enumLabel(t, LEDGER_REFERENCE_LABEL_KEY, row.original.reference_type),
        meta: {
          headerTitle: t("ledger.journal.columns.reference"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "state",
        enableSorting: false,
        header: () => t("ledger.journal.columns.state"),
        cell: ({ row }) => (
          <StatusBadge
            status={isReversedEntry(row.original) ? "reversed" : "posted"}
            labels={LEDGER_ENTRY_STATE_LABEL_KEY}
            variants={LEDGER_ENTRY_STATE_BADGE}
          />
        ),
        meta: {
          headerTitle: t("ledger.journal.columns.state"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
    ];
  }, [t, locale]);
}
