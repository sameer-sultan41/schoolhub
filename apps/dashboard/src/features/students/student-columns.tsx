"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  createSelectColumn,
  DataGridColumnHeader,
} from "@schoolhub/ui";
import { Pencil, UserMinus } from "lucide-react";

import { getInitials } from "@/lib/helpers";
import { STUDENT_WITHDRAWABLE_STATUS } from "@/services/modules/students/students-constant";
import type { StudentRow } from "@/services/modules/students/students-type";

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
            <Avatar className="size-8">
              <AvatarImage src={row.original.signedPhotoUrl} alt="" />
              <AvatarFallback>{getInitials(row.original.name)}</AvatarFallback>
            </Avatar>
            <div>
              <div className="font-medium">{row.original.name}</div>
              <div className="text-xs text-muted-foreground">{row.original.admissionNumber}</div>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "campus",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.campus")} />,
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("columns.status")} />
        ),
        cell: ({ row }) => <Badge appearance="light">{t(`status.${row.original.status}`)}</Badge>,
      },
      {
        accessorKey: "admissionDate",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("columns.admissionDate")} />
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            {canUpdate && (
              <Button
                size="icon"
                variant="ghost"
                aria-label={`${tCommon("edit")} ${row.original.name}`}
                onClick={() => {
                  onEdit(row.original.id);
                }}
              >
                <Pencil className="size-4" />
              </Button>
            )}
            {canWithdraw && row.original.status === STUDENT_WITHDRAWABLE_STATUS && (
              <Button
                size="icon"
                variant="ghost"
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
      },
    ],
    [t, tCommon, canUpdate, canWithdraw, onEdit, onWithdraw],
  );
}
