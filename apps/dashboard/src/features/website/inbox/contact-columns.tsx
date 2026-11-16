"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, cn, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { EMPTY_VALUE } from "@/lib/constants";
import { formatDate, formatLastUpdated } from "@/lib/helpers";
import type { ContactSubmissionRecord } from "@/services";
import { ContactStatusBadge } from "./contact-status-badge";

/**
 * The inbox's columns: when it arrived, who sent it (opening the message), the subject, how to
 * reach them and its status. A new message's sender is bold. Received, sender and status sort.
 */
export function useContactColumns(
  onOpen: (submission: ContactSubmissionRecord) => void,
): ColumnDef<ContactSubmissionRecord>[] {
  const t = useTranslations("website.inbox");
  const locale = useLocale();

  return useMemo<ColumnDef<ContactSubmissionRecord>[]>(
    () => [
      {
        id: "created_at",
        accessorKey: "created_at",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("columns.receivedAt")} />
        ),
        cell: ({ row }) => (
          <time
            dateTime={row.original.created_at}
            title={formatDate(row.original.created_at, locale)}
          >
            {formatLastUpdated(row.original.created_at)}
          </time>
        ),
        meta: { headerTitle: t("columns.receivedAt"), skeleton: <Skeleton className="h-4 w-24" /> },
      },
      {
        id: "name",
        accessorKey: "name",
        enableHiding: false,
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("columns.name")} />,
        cell: ({ row }) => (
          <Button
            mode="link"
            aria-label={t("openRow", { name: row.original.name })}
            className={cn(
              "max-w-xs text-start whitespace-normal",
              row.original.status === "new" ? "font-semibold" : "font-normal",
            )}
            onClick={() => {
              onOpen(row.original);
            }}
          >
            {row.original.name}
          </Button>
        ),
        meta: { headerTitle: t("columns.name"), skeleton: <Skeleton className="h-4 w-32" /> },
      },
      {
        id: "subject",
        accessorKey: "subject",
        enableSorting: false,
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("columns.subject")} />
        ),
        cell: ({ row }) => (
          <span className="line-clamp-2 max-w-sm">{row.original.subject || t("noSubject")}</span>
        ),
        meta: { headerTitle: t("columns.subject"), skeleton: <Skeleton className="h-4 w-40" /> },
      },
      {
        id: "contact",
        enableSorting: false,
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("columns.contact")} />
        ),
        cell: ({ row }) => (
          <span dir="ltr" className="break-all">
            {row.original.email || row.original.phone || EMPTY_VALUE}
          </span>
        ),
        meta: { headerTitle: t("columns.contact"), skeleton: <Skeleton className="h-4 w-32" /> },
      },
      {
        id: "status",
        accessorKey: "status",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("columns.status")} />
        ),
        cell: ({ row }) => <ContactStatusBadge status={row.original.status} />,
        meta: {
          headerTitle: t("columns.status"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
    ],
    [t, locale, onOpen],
  );
}
