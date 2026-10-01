"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  BadgeDot,
  Button,
  createSelectColumn,
  DataGridColumnHeader,
  Skeleton,
} from "@schoolhub/ui";
import { Pencil, UserMinus } from "lucide-react";

import { getInitials } from "@/lib/helpers";
import type { StudentRow } from "./student-row";

/** Column id -> the real `?ordering=` field name the `/students` list endpoint accepts. */
export const SORT_FIELD: Record<string, string> = {
  name: "last_name",
  admissionNumber: "admission_number",
  admissionDate: "admission_date",
  status: "status",
  campus: "campus_name",
};

// Only the variants a real status actually maps to, plus `secondary` (the unknown-status
// fallback) — `primary`/`warning` are deliberately absent so a later entry can't reach for
// the one color tenants rebrand (see the comment below) or an unused severity level.
export type StatusVariant = "success" | "destructive" | "secondary" | "info" | "rose";

/**
 * `status` -> badge color, the same shape as `/staff`'s own `STATUS_META`
 * (`staff-directory-table.tsx`) but reasoned from scratch — student statuses don't
 * correspond 1:1 to staff's. Labels stay fully translated (`t(`status.${status}`)`,
 * `messages/{en,ur}.json`'s `students.status.*`) — this map is color only, unlike
 * staff's hardcoded-label version, so the table doesn't regress on i18n coverage.
 *
 * `transferred` takes `info` (an administrative departure, not a failure — matches
 * staff's `retired: info`); `withdrawn` takes `rose` (neither success nor failure —
 * matches staff's `resigned: rose`). `graduated` also takes `success`, not a distinct
 * hue: DESIGN.md reserves color for product semantics a tenant can never repaint, and
 * `primary` is exactly the one color tenants *do* rebrand — using it for a status would
 * make that status's color tenant-dependent. The label (not the color) is what tells
 * "graduated" apart from "active"; DESIGN.md requires exactly that pairing ("never
 * encode meaning in colour alone").
 */
const STATUS_VARIANT: Record<string, StatusVariant> = {
  active: "success",
  suspended: "destructive",
  transferred: "info",
  withdrawn: "rose",
  graduated: "success",
};

export function statusVariant(status: string): StatusVariant {
  return STATUS_VARIANT[status] ?? "secondary";
}

/**
 * The directory table's column defs. Memoized on its real inputs — `t`, the two
 * permission flags, and the two row-action callbacks — so a parent re-render (e.g. a
 * page/sort/search keystroke) doesn't rebuild the array and force every cell to remount,
 * matching `staff-directory-table.tsx`'s own memoized `columns`.
 */
export function useStudentColumns(
  canUpdate: boolean,
  canWithdraw: boolean,
  onEdit: (id: string) => void,
  onWithdraw: (id: string, name: string) => void,
): ColumnDef<StudentRow>[] {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");

  return useMemo<ColumnDef<StudentRow>[]>(
    () => [
      createSelectColumn<StudentRow>({
        selectAll: t("idCards.selectAll"),
        selectRow: t("idCards.selectRow"),
      }),
      {
        accessorKey: "name",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("columns.name")} />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <Avatar className="size-8 transition-transform duration-200 hover:scale-110">
              <AvatarImage src={row.original.signedPhotoUrl} alt="" />
              <AvatarFallback>{getInitials(row.original.name)}</AvatarFallback>
            </Avatar>
            <div>
              <div className="font-medium">{row.original.name}</div>
              <div className="text-xs text-muted-foreground">{row.original.admissionNumber}</div>
            </div>
          </div>
        ),
        meta: {
          skeleton: (
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex flex-col gap-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ),
        },
      },
      {
        accessorKey: "campus",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.campus")} />,
        meta: { skeleton: <Skeleton className="h-4 w-24" /> },
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("columns.status")} />
        ),
        cell: ({ row }) => (
          <Badge
            size="lg"
            variant={statusVariant(row.original.status)}
            appearance="light"
            shape="circle"
          >
            <BadgeDot />
            {t(`status.${row.original.status}`)}
          </Badge>
        ),
        meta: { skeleton: <Skeleton className="h-6 w-20 rounded-full" /> },
      },
      {
        accessorKey: "admissionDate",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("columns.admissionDate")} />
        ),
        meta: { skeleton: <Skeleton className="h-4 w-20" /> },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            {canUpdate && (
              <Button
                variant="primary"
                appearance="light"
                mode="icon"
                shape="circle"
                size="sm"
                aria-label={`${tCommon("edit")} ${row.original.name}`}
                onClick={() => {
                  onEdit(row.original.id);
                }}
              >
                <Pencil className="size-4" />
              </Button>
            )}
            {canWithdraw && row.original.status === "active" && (
              <Button
                variant="destructive"
                appearance="light"
                mode="icon"
                shape="circle"
                size="sm"
                aria-label={`${t("actions.withdraw")} ${row.original.name}`}
                onClick={() => {
                  onWithdraw(row.original.id, row.original.name);
                }}
              >
                <UserMinus className="size-4" />
              </Button>
            )}
          </div>
        ),
        meta: { skeleton: <Skeleton className="size-7 rounded-full" /> },
      },
    ],
    [t, tCommon, canUpdate, canWithdraw, onEdit, onWithdraw],
  );
}
