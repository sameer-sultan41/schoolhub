"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { galleryAlbumPath } from "@/config/paths";
import { editColumn, statusColumn, updatedColumn } from "@/features/website/shared/content-columns";
import { EMPTY_VALUE } from "@/lib/constants";
import { formatDate } from "@/lib/helpers";
import type { GalleryAlbumRecord } from "@/services";

export interface AlbumColumnsOptions {
  /** `website.gallery-album.update`: the row's Edit. */
  canUpdate: boolean;
  onEdit: (album: GalleryAlbumRecord) => void;
}

/**
 * The albums directory's columns: the title (a link to the album's page, where its items and
 * lifecycle live), status, publish date and last change, each sortable, and the row's Edit.
 */
export function useAlbumColumns({
  canUpdate,
  onEdit,
}: AlbumColumnsOptions): ColumnDef<GalleryAlbumRecord>[] {
  const t = useTranslations("website.gallery");
  const locale = useLocale();

  return useMemo<ColumnDef<GalleryAlbumRecord>[]>(
    () => [
      {
        id: "title",
        accessorKey: "title",
        enableHiding: false,
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("columns.title")} />,
        cell: ({ row }) => (
          <Link
            href={galleryAlbumPath(row.original.id)}
            className="font-medium text-primary hover:underline"
          >
            {row.original.title}
          </Link>
        ),
        meta: { headerTitle: t("columns.title"), skeleton: <Skeleton className="h-4 w-40" /> },
      },
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
        label: t("actions.edit"),
        rowLabel: (album) => t("actions.editRow", { title: album.title }),
        onEdit,
      }),
    ],
    [t, locale, canUpdate, onEdit],
  );
}
