"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { websitePagePath } from "@/config/paths";
import { formatLastUpdated } from "@/lib/helpers";
import type { WebsitePageRecord } from "@/services";
import {
  HOME_PAGE_TYPE,
  PAGES_ACTIONS_COLUMN_ID,
} from "@/services/modules/website/website-pages/website-pages-constant";
import { pagePublicPath } from "@/services/modules/website/website-pages/website-pages-helper";
import { ContentStatusBadge } from "@/features/website/shared/content-status-badge";
import { usePageTypeLabel } from "./page-type-label";

export interface PageRowActions {
  canDelete: boolean;
  onDelete: (page: WebsitePageRecord) => void;
}

/**
 * The pages table's columns; every data column sorts (`PAGES_SORT_FIELD`). The title links to
 * the page's editor. Delete is offered only where the API could allow it: not on the home page,
 * and not while published. Memoized on its inputs, so the caller passes a stable handler.
 */
export function usePageColumns({ canDelete, onDelete }: PageRowActions) {
  const t = useTranslations("website.pages");
  const typeLabel = usePageTypeLabel();

  return useMemo<ColumnDef<WebsitePageRecord>[]>(
    () => [
      {
        id: "title",
        accessorKey: "title",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("columns.title")} />,
        cell: ({ row }) => (
          <Link
            href={websitePagePath(row.original.id)}
            className="font-medium text-foreground hover:text-primary hover:underline"
          >
            {row.original.title}
          </Link>
        ),
        meta: { headerTitle: t("columns.title"), skeleton: <Skeleton className="h-4 w-40" /> },
      },
      {
        id: "slug",
        accessorKey: "slug",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("columns.path")} />,
        cell: ({ row }) => (
          <span dir="ltr" className="font-mono text-xs text-muted-foreground">
            {pagePublicPath(row.original)}
          </span>
        ),
        meta: { headerTitle: t("columns.path"), skeleton: <Skeleton className="h-4 w-24" /> },
      },
      {
        id: "page_type",
        accessorKey: "page_type",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("columns.type")} />,
        cell: ({ row }) => typeLabel(row.original.page_type),
        meta: { headerTitle: t("columns.type"), skeleton: <Skeleton className="h-4 w-20" /> },
      },
      {
        id: "status",
        accessorKey: "status",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("columns.status")} />
        ),
        cell: ({ row }) => <ContentStatusBadge status={row.original.status} />,
        meta: {
          headerTitle: t("columns.status"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
      {
        id: "updated_at",
        accessorKey: "updated_at",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("columns.updated")} />
        ),
        cell: ({ row }) => formatLastUpdated(row.original.updated_at),
        meta: { headerTitle: t("columns.updated"), skeleton: <Skeleton className="h-4 w-20" /> },
      },
      {
        id: PAGES_ACTIONS_COLUMN_ID,
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const page = row.original;
          const deletable =
            canDelete && page.status !== "published" && page.page_type !== HOME_PAGE_TYPE;
          return (
            <RowEditRemoveActions
              removeLabel={deletable ? t("actions.deleteRow", { title: page.title }) : undefined}
              onRemove={() => {
                onDelete(page);
              }}
            />
          );
        },
        meta: { skeleton: <Skeleton className="h-7 w-8" /> },
      },
    ],
    [t, typeLabel, canDelete, onDelete],
  );
}
