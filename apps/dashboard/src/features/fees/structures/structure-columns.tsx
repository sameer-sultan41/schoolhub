"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { feeStructurePath } from "@/config/paths";
import { EMPTY_VALUE } from "@/lib/constants";
import type { FeeStructureRecord } from "@/services";
import { FEE_STRUCTURES_ACTIONS_COLUMN_ID } from "@/services/modules/fee-structures/fee-structures-constant";
import { isStructureEditable } from "@/services/modules/fee-structures/fee-structures-helper";
import { StructureStatusBadge } from "@/features/fees/shared/structure-status-badge";

export interface StructureRowActions {
  canUpdate: boolean;
  /** Each scope id's name; an id the viewer cannot read shows as a dash. */
  names: {
    sessions: ReadonlyMap<string, string>;
    classes: ReadonlyMap<string, string>;
    campuses: ReadonlyMap<string, string>;
  };
  onEdit: (record: FeeStructureRecord) => void;
}

/**
 * The structures table's columns; `name` is the one sortable id. The name links to the
 * structure's page. Edit shows to a holder of `fees.fee-structure.update` on a draft only: an
 * active or archived structure is fixed. Memoized on its inputs, so the caller passes
 * `useCallback`-stable handlers.
 */
export function useStructureColumns(actions: StructureRowActions): ColumnDef<FeeStructureRecord>[] {
  const t = useTranslations("fees");
  const { canUpdate, names, onEdit } = actions;

  return useMemo<ColumnDef<FeeStructureRecord>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("structures.columns.name")} />
        ),
        cell: ({ row }) => (
          <Link
            href={feeStructurePath(row.original.id)}
            className="font-medium text-foreground hover:text-primary hover:underline"
          >
            {row.original.name}
          </Link>
        ),
        meta: {
          headerTitle: t("structures.columns.name"),
          skeleton: <Skeleton className="h-4 w-40" />,
        },
      },
      {
        id: "session",
        enableSorting: false,
        header: () => t("structures.columns.session"),
        cell: ({ row }) => names.sessions.get(row.original.academic_session) ?? EMPTY_VALUE,
        meta: {
          headerTitle: t("structures.columns.session"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "class",
        enableSorting: false,
        header: () => t("structures.columns.class"),
        cell: ({ row }) =>
          row.original.school_class
            ? (names.classes.get(row.original.school_class) ?? EMPTY_VALUE)
            : t("structures.everyClass"),
        meta: {
          headerTitle: t("structures.columns.class"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "campus",
        enableSorting: false,
        header: () => t("structures.columns.campus"),
        cell: ({ row }) =>
          row.original.campus
            ? (names.campuses.get(row.original.campus) ?? EMPTY_VALUE)
            : t("structures.everyCampus"),
        meta: {
          headerTitle: t("structures.columns.campus"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "schedules",
        enableSorting: false,
        header: () => t("structures.columns.schedules"),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.schedules.length.toLocaleString()}</span>
        ),
        meta: {
          headerTitle: t("structures.columns.schedules"),
          skeleton: <Skeleton className="h-4 w-8" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("structures.columns.status"),
        cell: ({ row }) => <StructureStatusBadge status={row.original.status} />,
        meta: {
          headerTitle: t("structures.columns.status"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
      {
        id: FEE_STRUCTURES_ACTIONS_COLUMN_ID,
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const record = row.original;
          return (
            <RowEditRemoveActions
              editLabel={
                canUpdate && isStructureEditable(record)
                  ? t("structures.actions.editRow", { name: record.name })
                  : undefined
              }
              onEdit={() => {
                onEdit(record);
              }}
            />
          );
        },
        meta: { skeleton: <Skeleton className="h-7 w-10" /> },
      },
    ],
    [t, canUpdate, names, onEdit],
  );
}
