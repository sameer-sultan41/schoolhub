"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { EMPTY_VALUE } from "@/lib/constants";
import { enumLabel } from "@/lib/enum-label";
import { formatMoney } from "@/lib/format-decimal";
import { formatDate } from "@/lib/helpers";
import type { FineRecord } from "@/services";
import { canWaiveFine } from "@/services/modules/fines/fines-helper";
import {
  FINE_STATUS_BADGE,
  FINE_STATUS_LABEL_KEY,
  FINE_TYPE_LABEL_KEY,
} from "@/features/fees/shared/grant-labels";
import { LookedUpName } from "@/features/fees/shared/name-lookup";
import { GrantStatusBadge } from "./grant-status-badge";

export interface FineRowActions {
  canWaive: boolean;
  onWaive: (record: FineRecord) => void;
}

/**
 * The fines table's columns; `created_at` and `amount` are the sortable ids. The fee head arrives
 * through `LookedUpName`, never a dependency of this memo. Waive shows only to a holder of
 * `fees.fine.waive`, and only on a pending fine.
 */
export function useFineColumns({ canWaive, onWaive }: FineRowActions): ColumnDef<FineRecord>[] {
  const t = useTranslations("fees");
  const locale = useLocale();

  return useMemo<ColumnDef<FineRecord>[]>(
    () => [
      {
        id: "student",
        enableSorting: false,
        header: () => t("grants.fines.columns.student"),
        cell: ({ row }) => row.original.student_name,
        meta: {
          headerTitle: t("grants.fines.columns.student"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "type",
        enableSorting: false,
        header: () => t("grants.fines.columns.type"),
        cell: ({ row }) =>
          row.original.fine_type
            ? enumLabel(t, FINE_TYPE_LABEL_KEY, row.original.fine_type)
            : EMPTY_VALUE,
        meta: {
          headerTitle: t("grants.fines.columns.type"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "head",
        enableSorting: false,
        header: () => t("grants.fines.columns.head"),
        cell: ({ row }) => (
          <LookedUpName kind="heads" id={row.original.fee_head} fallback={EMPTY_VALUE} />
        ),
        meta: {
          headerTitle: t("grants.fines.columns.head"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "amount",
        accessorKey: "amount",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("grants.fines.columns.amount")} />
        ),
        cell: ({ row }) => (
          <span className="block text-end tabular-nums">
            {formatMoney(locale, row.original.amount)}
          </span>
        ),
        meta: {
          headerTitle: t("grants.fines.columns.amount"),
          skeleton: <Skeleton className="ms-auto h-4 w-16" />,
        },
      },
      {
        id: "reason",
        enableSorting: false,
        header: () => t("grants.fines.columns.reason"),
        cell: ({ row }) => row.original.reason,
        meta: {
          headerTitle: t("grants.fines.columns.reason"),
          skeleton: <Skeleton className="h-4 w-40" />,
        },
      },
      {
        id: "created_at",
        accessorKey: "created_at",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("grants.fines.columns.raised")} />
        ),
        cell: ({ row }) => formatDate(row.original.created_at, locale),
        meta: {
          headerTitle: t("grants.fines.columns.raised"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("grants.fines.columns.status"),
        cell: ({ row }) => (
          <GrantStatusBadge
            status={row.original.status}
            labels={FINE_STATUS_LABEL_KEY}
            variants={FINE_STATUS_BADGE}
          />
        ),
        meta: {
          headerTitle: t("grants.fines.columns.status"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
      ...(canWaive
        ? [
            {
              id: "actions",
              enableSorting: false,
              enableHiding: false,
              header: () => null,
              cell: ({ row }) =>
                canWaiveFine(row.original) ? (
                  <Button
                    variant="primary"
                    appearance="light"
                    size="sm"
                    aria-label={t("grants.fines.actions.waiveRow", {
                      name: row.original.student_name,
                    })}
                    onClick={() => {
                      onWaive(row.original);
                    }}
                  >
                    {t("grants.fines.actions.waive")}
                  </Button>
                ) : null,
              meta: { skeleton: <Skeleton className="h-7 w-16" /> },
            } satisfies ColumnDef<FineRecord>,
          ]
        : []),
    ],
    [t, locale, canWaive, onWaive],
  );
}
