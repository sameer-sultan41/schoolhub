"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, Button, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";
import { ListChecks, Star } from "lucide-react";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { EMPTY_VALUE } from "@/lib/constants";
import type { GradingScaleRecord } from "@/services";
import {
  DEFAULT_SCALE_TYPE,
  GRADING_SCALES_ACTIONS_COLUMN_ID,
} from "@/services/modules/grading-scales/grading-scales-constant";

export interface GradingScaleRowActions {
  canUpdate: boolean;
  onEdit: (record: GradingScaleRecord) => void;
  onRemove: (record: GradingScaleRecord) => void;
  onBands: (record: GradingScaleRecord) => void;
  onMakeDefault: (record: GradingScaleRecord) => void;
  /** The scale a Make default call is in flight for, so its button holds. */
  pendingDefaultId: string | null;
}

/**
 * The grading scales table's columns; ids are the keys of `GRADING_SCALES_SORT_FIELD`, plus
 * the unsortable `bands` count. Memoized on its inputs, so the caller passes `useCallback`-stable
 * handlers inside a memoized `actions` object.
 */
export function useGradingScaleColumns(
  actions: GradingScaleRowActions,
): ColumnDef<GradingScaleRecord>[] {
  const t = useTranslations("exams");
  const { canUpdate, onEdit, onRemove, onBands, onMakeDefault, pendingDefaultId } = actions;

  return useMemo<ColumnDef<GradingScaleRecord>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("gradingScales.columns.name")} />
        ),
        meta: {
          headerTitle: t("gradingScales.columns.name"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "type",
        enableSorting: false,
        header: () => t("gradingScales.columns.type"),
        cell: ({ row }) =>
          t(`gradingScales.types.${row.original.scale_type ?? DEFAULT_SCALE_TYPE}`),
        meta: {
          headerTitle: t("gradingScales.columns.type"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "bands",
        enableSorting: false,
        header: () => t("gradingScales.columns.bands"),
        cell: ({ row }) => row.original.bands.length.toLocaleString(),
        meta: {
          headerTitle: t("gradingScales.columns.bands"),
          skeleton: <Skeleton className="h-4 w-8" />,
        },
      },
      {
        id: "default",
        enableSorting: false,
        header: () => t("gradingScales.columns.default"),
        cell: ({ row }) =>
          row.original.is_default ? (
            <Badge variant="primary" appearance="light">
              <Star className="size-3" aria-hidden="true" />
              {t("gradingScales.default")}
            </Badge>
          ) : (
            EMPTY_VALUE
          ),
        meta: {
          headerTitle: t("gradingScales.columns.default"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
      {
        id: GRADING_SCALES_ACTIONS_COLUMN_ID,
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const record = row.original;
          return (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                aria-label={t("gradingScales.actions.bandsRow", { name: record.name })}
                onClick={() => {
                  onBands(record);
                }}
              >
                <ListChecks aria-hidden="true" />
                {t("gradingScales.actions.bands")}
              </Button>
              {canUpdate && !record.is_default && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pendingDefaultId !== null}
                  aria-label={t("gradingScales.actions.makeDefaultRow", { name: record.name })}
                  onClick={() => {
                    onMakeDefault(record);
                  }}
                >
                  <Star aria-hidden="true" />
                  {t("gradingScales.actions.makeDefault")}
                </Button>
              )}
              <RowEditRemoveActions
                editLabel={
                  canUpdate ? t("gradingScales.actions.editRow", { name: record.name }) : undefined
                }
                onEdit={() => {
                  onEdit(record);
                }}
                removeLabel={
                  canUpdate
                    ? t("gradingScales.actions.deleteRow", { name: record.name })
                    : undefined
                }
                onRemove={() => {
                  onRemove(record);
                }}
              />
            </div>
          );
        },
        meta: { skeleton: <Skeleton className="h-7 w-32" /> },
      },
    ],
    [t, canUpdate, onEdit, onRemove, onBands, onMakeDefault, pendingDefaultId],
  );
}
