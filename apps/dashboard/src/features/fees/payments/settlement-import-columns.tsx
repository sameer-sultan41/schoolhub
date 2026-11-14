"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { EMPTY_VALUE } from "@/lib/constants";
import { enumLabel } from "@/lib/enum-label";
import { formatDate } from "@/lib/helpers";
import type { SettlementImportRecord } from "@/services";
import { settlementExceptions } from "@/services/modules/settlement-imports/settlement-imports-helper";
import { StatusBadge } from "@/features/fees/shared/status-badge";
import {
  SETTLEMENT_STATUS_BADGE,
  SETTLEMENT_STATUS_LABEL_KEY,
} from "@/features/fees/shared/settlement-labels";
import { VOUCHER_PROVIDER_LABEL_KEY } from "@/features/fees/shared/voucher-labels";

/**
 * The settlement imports table's columns; `created_at` is the sortable id. The counts are the
 * server's (`row_count`, `matched_count`); the exceptions column counts the rows the record lists.
 * View opens the import's detail sheet.
 */
export function useSettlementImportColumns({
  onView,
}: {
  onView: (record: SettlementImportRecord) => void;
}): ColumnDef<SettlementImportRecord>[] {
  const t = useTranslations("fees");
  const providerT = useTranslations("portal.fees");
  const locale = useLocale();

  return useMemo<ColumnDef<SettlementImportRecord>[]>(
    () => [
      {
        id: "created_at",
        accessorKey: "created_at",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("payments.imports.columns.uploaded")} />
        ),
        cell: ({ row }) => formatDate(row.original.created_at, locale),
        meta: {
          headerTitle: t("payments.imports.columns.uploaded"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "provider",
        enableSorting: false,
        header: () => t("payments.imports.columns.provider"),
        cell: ({ row }) => enumLabel(providerT, VOUCHER_PROVIDER_LABEL_KEY, row.original.provider),
        meta: {
          headerTitle: t("payments.imports.columns.provider"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("payments.imports.columns.status"),
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.status}
            labels={SETTLEMENT_STATUS_LABEL_KEY}
            variants={SETTLEMENT_STATUS_BADGE}
          />
        ),
        meta: {
          headerTitle: t("payments.imports.columns.status"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
      {
        id: "rows",
        enableSorting: false,
        header: () => t("payments.imports.columns.rows"),
        cell: ({ row }) => <span className="tabular-nums">{row.original.row_count}</span>,
        meta: {
          headerTitle: t("payments.imports.columns.rows"),
          skeleton: <Skeleton className="h-4 w-10" />,
        },
      },
      {
        id: "matched",
        enableSorting: false,
        header: () => t("payments.imports.columns.matched"),
        cell: ({ row }) => <span className="tabular-nums">{row.original.matched_count}</span>,
        meta: {
          headerTitle: t("payments.imports.columns.matched"),
          skeleton: <Skeleton className="h-4 w-10" />,
        },
      },
      {
        id: "exceptions",
        enableSorting: false,
        header: () => t("payments.imports.columns.exceptions"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {settlementExceptions(row.original.exceptions).length}
          </span>
        ),
        meta: {
          headerTitle: t("payments.imports.columns.exceptions"),
          skeleton: <Skeleton className="h-4 w-10" />,
        },
      },
      {
        id: "completed",
        enableSorting: false,
        header: () => t("payments.imports.columns.completed"),
        cell: ({ row }) =>
          row.original.completed_at ? formatDate(row.original.completed_at, locale) : EMPTY_VALUE,
        meta: {
          headerTitle: t("payments.imports.columns.completed"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => null,
        cell: ({ row }) => (
          <Button
            variant="outline"
            size="sm"
            aria-label={t("payments.imports.actions.viewRow", {
              date: formatDate(row.original.created_at, locale),
            })}
            onClick={() => {
              onView(row.original);
            }}
          >
            {t("payments.imports.actions.view")}
          </Button>
        ),
        meta: { skeleton: <Skeleton className="h-7 w-16" /> },
      },
    ],
    [t, providerT, locale, onView],
  );
}
