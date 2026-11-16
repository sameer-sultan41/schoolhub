"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { formatLastUpdated } from "@/lib/helpers";
import type { WebsiteContentStatus } from "@/services";
import { canEditContent } from "./content-permissions";
import { ContentStatusBadge } from "./content-status-badge";

/** What every news post, event and album row carries. */
export interface ContentRow {
  id: string;
  title: string;
  status: WebsiteContentStatus;
  updated_at: string;
}

/**
 * The columns the news, events and albums directories share, built from translated labels:
 * the title (an action that opens the record), status and last change, each sortable, and the
 * row's Edit. Each directory adds its own between them.
 */

export function titleColumn<T extends ContentRow>(
  label: string,
  onOpen: (row: T) => void,
): ColumnDef<T> {
  return {
    id: "title",
    accessorKey: "title",
    enableHiding: false,
    header: ({ column }) => <DataGridColumnHeader column={column} title={label} />,
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
    meta: { headerTitle: label, skeleton: <Skeleton className="h-4 w-40" /> },
  };
}

export function statusColumn<T extends ContentRow>(label: string): ColumnDef<T> {
  return {
    id: "status",
    accessorKey: "status",
    header: ({ column }) => <DataGridColumnHeader column={column} title={label} />,
    cell: ({ row }) => <ContentStatusBadge status={row.original.status} />,
    meta: { headerTitle: label, skeleton: <Skeleton className="h-5 w-16 rounded-full" /> },
  };
}

export function updatedColumn<T extends ContentRow>(label: string): ColumnDef<T> {
  return {
    id: "updated_at",
    accessorKey: "updated_at",
    header: ({ column }) => <DataGridColumnHeader column={column} title={label} />,
    cell: ({ row }) => formatLastUpdated(row.original.updated_at),
    meta: { headerTitle: label, skeleton: <Skeleton className="h-4 w-24" /> },
  };
}

/** The row's Edit, offered only where `canEditContent` allows it (the update key, and the
 * publish key on a published row). `rowLabel` names the record for a screen reader. */
export function editColumn<T extends ContentRow>({
  canUpdate,
  canPublish,
  label,
  rowLabel,
  onEdit,
}: {
  canUpdate: boolean;
  canPublish: boolean;
  label: string;
  rowLabel: (row: T) => string;
  onEdit: (row: T) => void;
}): ColumnDef<T> {
  return {
    id: "actions",
    enableSorting: false,
    enableHiding: false,
    header: () => null,
    cell: ({ row }) =>
      canEditContent(row.original.status, canUpdate, canPublish) ? (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            appearance="light"
            size="sm"
            aria-label={rowLabel(row.original)}
            onClick={() => {
              onEdit(row.original);
            }}
          >
            {label}
          </Button>
        </div>
      ) : null,
    meta: { skeleton: <Skeleton className="h-7 w-16" /> },
  };
}
