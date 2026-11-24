"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { platformTenantPath } from "@/config/paths";
import { EMPTY_VALUE } from "@/lib/constants";
import { formatDate } from "@/lib/helpers";
import type { TenantRecord } from "@/services";
import { TenantStatusBadge } from "@/features/platform/shared/platform-badges";

/** The tenants list's columns; sortable ids are the keys of `TENANT_SORT_FIELD`. Every action is
 * on the school's own page, so a row has none: its name is the link there. */
export function useTenantColumns(): ColumnDef<TenantRecord>[] {
  const t = useTranslations("platform");
  const locale = useLocale();

  return useMemo<ColumnDef<TenantRecord>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("tenants.fields.name")} />
        ),
        cell: ({ row }) => (
          <Link
            href={platformTenantPath(row.original.id)}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {row.original.name}
          </Link>
        ),
        meta: {
          headerTitle: t("tenants.fields.name"),
          skeleton: <Skeleton className="h-4 w-36" />,
        },
      },
      {
        id: "slug",
        accessorKey: "slug",
        enableSorting: false,
        header: () => t("tenants.fields.slug"),
        meta: {
          headerTitle: t("tenants.fields.slug"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "status",
        accessorKey: "status",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("tenants.fields.status")} />
        ),
        cell: ({ row }) => <TenantStatusBadge status={row.original.status} />,
        meta: {
          headerTitle: t("tenants.fields.status"),
          skeleton: <Skeleton className="h-5 w-20 rounded-full" />,
        },
      },
      {
        id: "plan",
        accessorKey: "current_plan",
        enableSorting: false,
        header: () => t("tenants.fields.plan"),
        cell: ({ row }) => row.original.current_plan || EMPTY_VALUE,
        meta: {
          headerTitle: t("tenants.fields.plan"),
          skeleton: <Skeleton className="h-4 w-16" />,
        },
      },
      {
        id: "contact",
        enableSorting: false,
        header: () => t("tenants.fields.contact"),
        cell: ({ row }) =>
          [row.original.contact_name, row.original.contact_email].filter(Boolean).join(" · ") ||
          EMPTY_VALUE,
        meta: {
          headerTitle: t("tenants.fields.contact"),
          skeleton: <Skeleton className="h-4 w-40" />,
        },
      },
      {
        id: "created",
        accessorKey: "created_at",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("tenants.fields.created")} />
        ),
        cell: ({ row }) => formatDate(row.original.created_at, locale),
        meta: {
          headerTitle: t("tenants.fields.created"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
    ],
    [t, locale],
  );
}
