"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import {
  editColumn,
  statusColumn,
  titleColumn,
  updatedColumn,
} from "@/features/website/shared/content-columns";
import { EMPTY_VALUE } from "@/lib/constants";
import { formatDate } from "@/lib/helpers";
import type { NewsPostRecord } from "@/services";

export interface NewsColumnsOptions {
  /** `website.news-post.update`: the row's Edit. */
  canUpdate: boolean;
  /** `website.news-post.publish`: Edit on a published row. */
  canPublish: boolean;
  onOpen: (post: NewsPostRecord) => void;
  onEdit: (post: NewsPostRecord) => void;
}

/**
 * The news directory's columns: the title (opening the detail sheet, where the lifecycle and
 * Delete live), status, publish date and last change, each sortable, and the row's Edit.
 */
export function useNewsColumns({
  canUpdate,
  canPublish,
  onOpen,
  onEdit,
}: NewsColumnsOptions): ColumnDef<NewsPostRecord>[] {
  const t = useTranslations("website.news");
  const locale = useLocale();

  return useMemo<ColumnDef<NewsPostRecord>[]>(
    () => [
      titleColumn(t("columns.title"), onOpen),
      statusColumn(t("columns.status")),
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
      updatedColumn(t("columns.updatedAt")),
      editColumn({
        canUpdate,
        canPublish,
        label: t("actions.edit"),
        rowLabel: (post) => t("actions.editRow", { title: post.title }),
        onEdit,
      }),
    ],
    [t, locale, canUpdate, canPublish, onOpen, onEdit],
  );
}
