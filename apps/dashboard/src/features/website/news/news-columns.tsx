"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { EMPTY_VALUE } from "@/lib/constants";
import { formatDate, formatLastUpdated } from "@/lib/helpers";
import type { NewsPostRecord } from "@/services";
import { ContentStatusBadge } from "@/features/website/shared/content-status-badge";

export interface NewsColumnsOptions {
  /** `website.news-post.update`: the row's Edit. */
  canUpdate: boolean;
  onOpen: (post: NewsPostRecord) => void;
  onEdit: (post: NewsPostRecord) => void;
}

/**
 * The news directory's columns: the title (opening the detail sheet, where the lifecycle and
 * Delete live), status, publish date and last change, each sortable, and the row's Edit.
 */
export function useNewsColumns({
  canUpdate,
  onOpen,
  onEdit,
}: NewsColumnsOptions): ColumnDef<NewsPostRecord>[] {
  const t = useTranslations("website.news");
  const locale = useLocale();

  return useMemo<ColumnDef<NewsPostRecord>[]>(
    () => [
      {
        id: "title",
        accessorKey: "title",
        enableHiding: false,
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("columns.title")} />,
        cell: ({ row }) => (
          <Button
            mode="link"
            className="max-w-xs text-start font-medium whitespace-normal"
            onClick={() => {
              onOpen(row.original);
            }}
          >
            {row.original.title}
          </Button>
        ),
        meta: { headerTitle: t("columns.title"), skeleton: <Skeleton className="h-4 w-40" /> },
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
        id: "published_at",
        accessorKey: "published_at",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("columns.publishedAt")} />
        ),
        cell: ({ row }) =>
          row.original.published_at ? formatDate(row.original.published_at, locale) : EMPTY_VALUE,
        meta: {
          headerTitle: t("columns.publishedAt"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "updated_at",
        accessorKey: "updated_at",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("columns.updatedAt")} />
        ),
        cell: ({ row }) => formatLastUpdated(row.original.updated_at),
        meta: { headerTitle: t("columns.updatedAt"), skeleton: <Skeleton className="h-4 w-24" /> },
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => null,
        cell: ({ row }) =>
          canUpdate ? (
            <div className="flex justify-end">
              <Button
                variant="secondary"
                appearance="light"
                size="sm"
                aria-label={t("actions.editRow", { title: row.original.title })}
                onClick={() => {
                  onEdit(row.original);
                }}
              >
                {t("actions.edit")}
              </Button>
            </div>
          ) : null,
        meta: { skeleton: <Skeleton className="h-7 w-16" /> },
      },
    ],
    [t, locale, canUpdate, onOpen, onEdit],
  );
}
