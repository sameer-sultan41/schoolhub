"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { EMPTY_VALUE } from "@/lib/constants";
import { enumLabel } from "@/lib/enum-label";
import { formatDecimal, formatMoney } from "@/lib/format-decimal";
import { formatDate } from "@/lib/helpers";
import type { ScholarshipRecord, ScholarshipStatus } from "@/services";
import { nextScholarshipStatuses } from "@/services/modules/scholarships/scholarships-helper";
import {
  GRANT_VALUE_TYPE_LABEL_KEY,
  SCHOLARSHIP_ACTION_LABEL_KEY,
  SCHOLARSHIP_STATUS_BADGE,
  SCHOLARSHIP_STATUS_LABEL_KEY,
  SCHOLARSHIP_TYPE_LABEL_KEY,
} from "@/features/fees/shared/grant-labels";
import { LookedUpName } from "@/features/fees/shared/name-lookup";
import { StatusBadge } from "@/features/fees/shared/status-badge";

export interface ScholarshipRowActions {
  /** Whether the viewer holds `fees.scholarship.create`, the key every status move needs. */
  canChangeStatus: boolean;
  onMove: (record: ScholarshipRecord, to: ScholarshipStatus) => void;
}

/**
 * The scholarships table's columns; `created_at` and `value` are the sortable ids. The actions
 * column offers only the moves the server's lifecycle table allows from the row's status (none
 * for an ended or revoked award, so its cell is empty). Names arrive through `LookedUpName`.
 */
export function useScholarshipColumns({
  canChangeStatus,
  onMove,
}: ScholarshipRowActions): ColumnDef<ScholarshipRecord>[] {
  const t = useTranslations("fees");
  const locale = useLocale();

  return useMemo<ColumnDef<ScholarshipRecord>[]>(
    () => [
      {
        id: "student",
        enableSorting: false,
        header: () => t("grants.scholarships.columns.student"),
        cell: ({ row }) => row.original.student_name,
        meta: {
          headerTitle: t("grants.scholarships.columns.student"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "name",
        enableSorting: false,
        header: () => t("grants.scholarships.columns.name"),
        cell: ({ row }) => <span className="font-medium text-foreground">{row.original.name}</span>,
        meta: {
          headerTitle: t("grants.scholarships.columns.name"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "type",
        enableSorting: false,
        header: () => t("grants.scholarships.columns.type"),
        cell: ({ row }) =>
          row.original.scholarship_type
            ? enumLabel(t, SCHOLARSHIP_TYPE_LABEL_KEY, row.original.scholarship_type)
            : EMPTY_VALUE,
        meta: {
          headerTitle: t("grants.scholarships.columns.type"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "value",
        accessorKey: "value",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("grants.scholarships.columns.value")} />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.coverage_type === "percent"
              ? `${formatDecimal(locale, row.original.value)}%`
              : formatMoney(locale, row.original.value)}
            <span className="ms-1.5 text-xs text-muted-foreground">
              {enumLabel(t, GRANT_VALUE_TYPE_LABEL_KEY, row.original.coverage_type)}
            </span>
          </span>
        ),
        meta: {
          headerTitle: t("grants.scholarships.columns.value"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "sponsor",
        enableSorting: false,
        header: () => t("grants.scholarships.columns.sponsor"),
        cell: ({ row }) => row.original.sponsor || EMPTY_VALUE,
        meta: {
          headerTitle: t("grants.scholarships.columns.sponsor"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "session",
        enableSorting: false,
        header: () => t("grants.scholarships.columns.session"),
        cell: ({ row }) => (
          <LookedUpName kind="sessions" id={row.original.academic_session} fallback={EMPTY_VALUE} />
        ),
        meta: {
          headerTitle: t("grants.scholarships.columns.session"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "created_at",
        accessorKey: "created_at",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("grants.scholarships.columns.awarded")} />
        ),
        cell: ({ row }) => formatDate(row.original.created_at, locale),
        meta: {
          headerTitle: t("grants.scholarships.columns.awarded"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("grants.scholarships.columns.status"),
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.status ?? "applied"}
            labels={SCHOLARSHIP_STATUS_LABEL_KEY}
            variants={SCHOLARSHIP_STATUS_BADGE}
          />
        ),
        meta: {
          headerTitle: t("grants.scholarships.columns.status"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
      ...(canChangeStatus
        ? [
            {
              id: "actions",
              enableSorting: false,
              enableHiding: false,
              header: () => null,
              cell: ({ row }) => (
                <div className="flex items-center gap-1">
                  {nextScholarshipStatuses(row.original.status ?? "applied").map((to) => (
                    <Button
                      key={to}
                      variant={to === "revoked" ? "destructive" : "primary"}
                      appearance="light"
                      size="sm"
                      aria-label={t("grants.scholarships.actions.statusRow", {
                        action: enumLabel(t, SCHOLARSHIP_ACTION_LABEL_KEY, to),
                        name: row.original.name,
                      })}
                      onClick={() => {
                        onMove(row.original, to);
                      }}
                    >
                      {enumLabel(t, SCHOLARSHIP_ACTION_LABEL_KEY, to)}
                    </Button>
                  ))}
                </div>
              ),
              meta: { skeleton: <Skeleton className="h-7 w-24" /> },
            } satisfies ColumnDef<ScholarshipRecord>,
          ]
        : []),
    ],
    [t, locale, canChangeStatus, onMove],
  );
}
