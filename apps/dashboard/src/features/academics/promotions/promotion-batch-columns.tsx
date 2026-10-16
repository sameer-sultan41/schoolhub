"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { promotionBatchPath } from "@/config/paths";
import { formatDate, formatLastUpdated } from "@/lib/helpers";
import type { PromotionBatchRecord } from "@/services";
import { PromotionStatusBadge } from "./promotion-status-badge";

/**
 * The batch list's column defs. The sortable ids are the keys of `PROMOTION_SORT_FIELD`
 * (`status`, `students`, `startedAt`); From class and Sessions are not sortable by the API.
 * From class is the row's link to the batch (and can't be hidden), so the keyboard reaches it
 * whatever else is hidden.
 */
export function usePromotionBatchColumns(): ColumnDef<PromotionBatchRecord>[] {
  const t = useTranslations("academics");
  const locale = useLocale();

  return useMemo<ColumnDef<PromotionBatchRecord>[]>(() => {
    const sessionsOf = (batch: PromotionBatchRecord) =>
      t("promotions.sessionPair", {
        from: batch.from_academic_session_name,
        to: batch.to_academic_session_name,
      });

    return [
      {
        id: "fromClass",
        accessorKey: "from_class_name",
        enableSorting: false,
        enableHiding: false,
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("promotions.columns.fromClass")} />
        ),
        // The name carries the sessions too: one class can have several batches, and a list
        // of links all called "Grade 1" tells a screen-reader user nothing.
        cell: ({ row }) => (
          <Link
            href={promotionBatchPath(row.original.batch_id)}
            aria-label={t("promotions.batchLabel", {
              className: row.original.from_class_name,
              sessions: sessionsOf(row.original),
            })}
            className="font-medium text-foreground underline-offset-4 hover:text-primary hover:underline"
          >
            {row.original.from_class_name}
          </Link>
        ),
        meta: {
          headerTitle: t("promotions.columns.fromClass"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "sessions",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("promotions.columns.sessions")} />
        ),
        cell: ({ row }) => sessionsOf(row.original),
        meta: {
          headerTitle: t("promotions.columns.sessions"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "students",
        accessorKey: "students",
        // `ms-auto` pushes the header to the end inside the grid's flex header wrapper.
        header: ({ column }) => (
          <DataGridColumnHeader
            column={column}
            title={t("promotions.columns.students")}
            className="ms-auto"
          />
        ),
        cell: ({ row }) => row.original.students.toLocaleString(locale),
        meta: {
          headerTitle: t("promotions.columns.students"),
          headerClassName: "text-end",
          cellClassName: "text-end tabular-nums",
          skeleton: <Skeleton className="h-4 w-8" />,
        },
      },
      {
        id: "status",
        accessorKey: "status",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("promotions.columns.status")} />
        ),
        cell: ({ row }) => <PromotionStatusBadge status={row.original.status} />,
        meta: {
          headerTitle: t("promotions.columns.status"),
          skeleton: <Skeleton className="h-6 w-28 rounded-full" />,
        },
      },
      {
        id: "startedAt",
        accessorKey: "started_at",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("promotions.columns.startedAt")} />
        ),
        // Relative, with the exact day on hover: "3 days ago" is what a reviewer scans for.
        cell: ({ row }) => (
          <time
            dateTime={row.original.started_at}
            title={formatDate(row.original.started_at, locale)}
          >
            {formatLastUpdated(row.original.started_at)}
          </time>
        ),
        meta: {
          headerTitle: t("promotions.columns.startedAt"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
    ];
  }, [t, locale]);
}
