"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { EMPTY_VALUE } from "@/lib/constants";
import { enumLabel } from "@/lib/enum-label";
import { formatDecimal, formatMoney } from "@/lib/format-decimal";
import { formatDate } from "@/lib/helpers";
import type { DiscountRecord } from "@/services";
import { canRevokeDiscount } from "@/services/modules/discounts/discounts-helper";
import {
  DISCOUNT_STATUS_BADGE,
  DISCOUNT_STATUS_LABEL_KEY,
  GRANT_VALUE_TYPE_LABEL_KEY,
} from "@/features/fees/shared/grant-labels";
import { LookedUpName } from "@/features/fees/shared/name-lookup";
import { GrantStatusBadge } from "./grant-status-badge";

export interface DiscountRowActions {
  canRevoke: boolean;
  onRevoke: (record: DiscountRecord) => void;
}

/**
 * The discounts table's columns; `created_at` and `value` are the sortable ids. Names (fee head,
 * session) arrive through `LookedUpName`, never a dependency of this memo. Revoke shows only to
 * a holder of `fees.discount.waive`, and only on an active discount.
 */
export function useDiscountColumns({
  canRevoke,
  onRevoke,
}: DiscountRowActions): ColumnDef<DiscountRecord>[] {
  const t = useTranslations("fees");
  const locale = useLocale();

  return useMemo<ColumnDef<DiscountRecord>[]>(
    () => [
      {
        id: "student",
        enableSorting: false,
        header: () => t("grants.discounts.columns.student"),
        cell: ({ row }) => row.original.student_name,
        meta: {
          headerTitle: t("grants.discounts.columns.student"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "name",
        enableSorting: false,
        header: () => t("grants.discounts.columns.name"),
        cell: ({ row }) => <span className="font-medium text-foreground">{row.original.name}</span>,
        meta: {
          headerTitle: t("grants.discounts.columns.name"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "value",
        accessorKey: "value",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("grants.discounts.columns.value")} />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.discount_type === "percent"
              ? `${formatDecimal(locale, row.original.value)}%`
              : formatMoney(locale, row.original.value)}
            <span className="ms-1.5 text-xs text-muted-foreground">
              {enumLabel(t, GRANT_VALUE_TYPE_LABEL_KEY, row.original.discount_type)}
            </span>
          </span>
        ),
        meta: {
          headerTitle: t("grants.discounts.columns.value"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "head",
        enableSorting: false,
        header: () => t("grants.discounts.columns.head"),
        cell: ({ row }) =>
          row.original.fee_head ? (
            <LookedUpName kind="heads" id={row.original.fee_head} fallback={EMPTY_VALUE} />
          ) : (
            t("grants.discounts.allHeads")
          ),
        meta: {
          headerTitle: t("grants.discounts.columns.head"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "session",
        enableSorting: false,
        header: () => t("grants.discounts.columns.session"),
        cell: ({ row }) => (
          <LookedUpName kind="sessions" id={row.original.academic_session} fallback={EMPTY_VALUE} />
        ),
        meta: {
          headerTitle: t("grants.discounts.columns.session"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "validity",
        enableSorting: false,
        header: () => t("grants.discounts.columns.validity"),
        cell: ({ row }) => {
          const { valid_from: from, valid_to: to } = row.original;
          if (!from && !to) return t("grants.discounts.validity.always");
          return [
            from && t("grants.discounts.validity.from", { date: formatDate(from, locale) }),
            to && t("grants.discounts.validity.to", { date: formatDate(to, locale) }),
          ]
            .filter(Boolean)
            .join(" ");
        },
        meta: {
          headerTitle: t("grants.discounts.columns.validity"),
          skeleton: <Skeleton className="h-4 w-28" />,
        },
      },
      {
        id: "created_at",
        accessorKey: "created_at",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("grants.discounts.columns.granted")} />
        ),
        cell: ({ row }) => formatDate(row.original.created_at, locale),
        meta: {
          headerTitle: t("grants.discounts.columns.granted"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("grants.discounts.columns.status"),
        cell: ({ row }) => (
          <GrantStatusBadge
            status={row.original.status}
            labels={DISCOUNT_STATUS_LABEL_KEY}
            variants={DISCOUNT_STATUS_BADGE}
          />
        ),
        meta: {
          headerTitle: t("grants.discounts.columns.status"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
      ...(canRevoke
        ? [
            {
              id: "actions",
              enableSorting: false,
              enableHiding: false,
              header: () => null,
              cell: ({ row }) =>
                canRevokeDiscount(row.original) ? (
                  <Button
                    variant="destructive"
                    appearance="light"
                    size="sm"
                    aria-label={t("grants.discounts.actions.revokeRow", {
                      name: row.original.name,
                    })}
                    onClick={() => {
                      onRevoke(row.original);
                    }}
                  >
                    {t("grants.discounts.actions.revoke")}
                  </Button>
                ) : null,
              meta: { skeleton: <Skeleton className="h-7 w-16" /> },
            } satisfies ColumnDef<DiscountRecord>,
          ]
        : []),
    ],
    [t, locale, canRevoke, onRevoke],
  );
}
