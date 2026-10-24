"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, BadgeDot, Button, DataGridColumnHeader } from "@schoolhub/ui";
import { Pencil } from "lucide-react";

import { EMPTY_VALUE } from "@/lib/constants";
import type { PromotionDecisionRecord } from "@/services";
import { lacksTargetSection } from "@/services/modules/promotions/promotions-helper";
import { PromotionDecisionBadge } from "./promotion-decision-badge";

/** A dash for a value a row doesn't have, with the word for screen readers. */
function EmptyCell() {
  const t = useTranslations("academics");

  return (
    <>
      <span aria-hidden="true">{EMPTY_VALUE}</span>
      <span className="sr-only">{t("promotions.fields.none")}</span>
    </>
  );
}

/** A free-text cell (override reason, remarks): wraps, rather than stretching the table. */
function TextCell({ value }: { value: string | null | undefined }) {
  if (!value) return <EmptyCell />;
  return <span className="block max-w-72 break-words whitespace-normal">{value}</span>;
}

/** The name of the target (a class or a section), or a dash for none. */
function NameCell({ name }: { name: string | null }) {
  return name ?? <EmptyCell />;
}

/** The target section; a row that will fail on execute says so where the section should be. */
function SectionCell({ row }: { row: PromotionDecisionRecord }) {
  const t = useTranslations("academics");

  if (row.to_section_name || !lacksTargetSection(row)) {
    return <NameCell name={row.to_section_name} />;
  }
  return (
    <Badge variant="warning" appearance="light">
      <BadgeDot />
      {t("promotions.fields.sectionNotSet")}
    </Badge>
  );
}

/**
 * The decision table's column defs: the student, the decision, where they go, why it differs from
 * the proposal, and (when `canEdit`) an Edit button on each row. The status is deliberately not a
 * column: every row of a batch shares the batch's, which the header already shows. Pass a stable
 * `onEdit`.
 */
export function usePromotionDecisionColumns(
  canEdit: boolean,
  onEdit: (row: PromotionDecisionRecord) => void,
): ColumnDef<PromotionDecisionRecord>[] {
  const t = useTranslations("academics");

  return useMemo<ColumnDef<PromotionDecisionRecord>[]>(() => {
    const columns: ColumnDef<PromotionDecisionRecord>[] = [
      {
        id: "student",
        accessorKey: "student_name",
        enableSorting: false,
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("promotions.columns.student")} />
        ),
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            <span className="font-medium text-foreground">{row.original.student_name}</span>
            <span className="text-xs text-muted-foreground">{row.original.admission_number}</span>
          </div>
        ),
        meta: { headerTitle: t("promotions.columns.student") },
      },
      {
        id: "decision",
        accessorKey: "decision",
        enableSorting: false,
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("promotions.columns.decision")} />
        ),
        cell: ({ row }) => <PromotionDecisionBadge decision={row.original.decision} />,
        meta: { headerTitle: t("promotions.columns.decision") },
      },
      {
        id: "toClass",
        accessorKey: "to_class_name",
        enableSorting: false,
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("promotions.fields.toClass")} />
        ),
        cell: ({ row }) => <NameCell name={row.original.to_class_name} />,
        meta: { headerTitle: t("promotions.fields.toClass") },
      },
      {
        id: "toSection",
        accessorKey: "to_section_name",
        enableSorting: false,
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("promotions.fields.toSection")} />
        ),
        cell: ({ row }) => <SectionCell row={row.original} />,
        meta: { headerTitle: t("promotions.fields.toSection") },
      },
      {
        id: "overrideReason",
        accessorKey: "override_reason",
        enableSorting: false,
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("promotions.fields.overrideReason")} />
        ),
        cell: ({ row }) => <TextCell value={row.original.override_reason} />,
        meta: { headerTitle: t("promotions.fields.overrideReason") },
      },
      {
        id: "remarks",
        accessorKey: "remarks",
        enableSorting: false,
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("promotions.fields.remarks")} />
        ),
        cell: ({ row }) => <TextCell value={row.original.remarks} />,
        meta: { headerTitle: t("promotions.fields.remarks") },
      },
    ];
    if (canEdit) {
      columns.push({
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span className="sr-only">{t("promotions.columns.actions")}</span>,
        cell: ({ row }) => (
          <Button
            variant="primary"
            appearance="light"
            mode="icon"
            shape="circle"
            size="sm"
            aria-label={t("promotions.actions.editRow", { student: row.original.student_name })}
            onClick={() => {
              onEdit(row.original);
            }}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
        ),
      });
    }
    return columns;
  }, [t, canEdit, onEdit]);
}
