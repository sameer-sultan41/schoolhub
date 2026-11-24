"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { enumLabel } from "@/lib/enum-label";
import { formatMoney } from "@/lib/format-decimal";
import type { PlanRecord } from "@/services";
import { PLATFORM_ACTIONS_COLUMN_ID } from "@/services/modules/platform/platform-constant";

const PERIOD_LABELS = {
  monthly: "plans.period.monthly",
  annual: "plans.period.annual",
} as const;

/** The plans list's columns; sortable ids are the keys of `PLAN_SORT_FIELD`. Memoized on its
 * inputs, so callers pass `useCallback`-stable handlers. */
export function usePlanColumns(
  canEdit: boolean,
  canRetire: boolean,
  onEdit: (plan: PlanRecord) => void,
  onRetire: (plan: PlanRecord) => void,
): ColumnDef<PlanRecord>[] {
  const t = useTranslations("platform");
  const locale = useLocale();

  return useMemo<ColumnDef<PlanRecord>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("plans.fields.name")} />
        ),
        meta: { headerTitle: t("plans.fields.name"), skeleton: <Skeleton className="h-4 w-28" /> },
      },
      {
        id: "code",
        accessorKey: "code",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("plans.fields.code")} />
        ),
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.code}</span>,
        meta: { headerTitle: t("plans.fields.code"), skeleton: <Skeleton className="h-4 w-20" /> },
      },
      {
        id: "price",
        accessorKey: "price_amount",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("plans.fields.price")} />
        ),
        cell: ({ row }) =>
          t("plans.priceFor", {
            amount: formatMoney(locale, row.original.price_amount),
            currency: row.original.currency,
            period: enumLabel(t, PERIOD_LABELS, row.original.billing_period),
          }),
        meta: { headerTitle: t("plans.fields.price"), skeleton: <Skeleton className="h-4 w-28" /> },
      },
      {
        id: "modules",
        enableSorting: false,
        header: () => t("plans.fields.modules"),
        cell: ({ row }) => row.original.enabled_modules.length.toLocaleString(locale),
        meta: {
          headerTitle: t("plans.fields.modules"),
          skeleton: <Skeleton className="h-4 w-8" />,
        },
      },
      {
        id: "status",
        accessorKey: "is_active",
        enableSorting: false,
        header: () => t("plans.fields.status"),
        cell: ({ row }) =>
          row.original.is_active ? (
            <Badge variant="success" appearance="light">
              {t("plans.active")}
            </Badge>
          ) : (
            <Badge variant="secondary" appearance="light">
              {t("plans.retired")}
            </Badge>
          ),
        meta: {
          headerTitle: t("plans.fields.status"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
      {
        id: PLATFORM_ACTIONS_COLUMN_ID,
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const plan = row.original;
          return (
            <RowEditRemoveActions
              editLabel={canEdit ? t("plans.editRow", { name: plan.name }) : undefined}
              onEdit={() => {
                onEdit(plan);
              }}
              removeLabel={
                canRetire && plan.is_active ? t("plans.retireRow", { name: plan.name }) : undefined
              }
              onRemove={() => {
                onRetire(plan);
              }}
            />
          );
        },
        meta: { skeleton: <Skeleton className="size-7 rounded-full" /> },
      },
    ],
    [t, locale, canEdit, canRetire, onEdit, onRetire],
  );
}
