"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Skeleton } from "@schoolhub/ui";
import { Download, MessageSquareText } from "lucide-react";

import { EMPTY_VALUE } from "@/lib/constants";
import type { ReportCardRecord } from "@/services";
import { REPORT_CARD_ACTIONS_COLUMN_ID } from "@/services/modules/report-cards/report-cards-constant";
import {
  areRemarksEditable,
  isReportCardDownloadable,
} from "@/services/modules/report-cards/report-cards-helper";
import { ReportCardStatusBadge } from "./report-card-status-badge";

export interface ReportCardColumnsOptions {
  /** The viewer holds a key that writes a remark field: Remarks shows on an unpublished card. */
  canWriteRemarks: boolean;
  /** The card whose link is being fetched: its Download is held. */
  downloadingId: string | null;
  /** Both must be `useCallback`-stable, or the columns rebuild on every render. */
  onDownload: (card: ReportCardRecord) => void;
  onRemarks: (card: ReportCardRecord) => void;
}

/**
 * The Report cards tab's columns: student, section, percentage and grade, version, status and the
 * row's actions. Download shows once the generation job wrote a PDF, the server's rule for
 * `:download`; Remarks until the card is published.
 */
export function useReportCardColumns({
  canWriteRemarks,
  downloadingId,
  onDownload,
  onRemarks,
}: ReportCardColumnsOptions): ColumnDef<ReportCardRecord>[] {
  const t = useTranslations("exams");

  return useMemo<ColumnDef<ReportCardRecord>[]>(
    () => [
      {
        id: "student",
        enableSorting: false,
        header: () => t("reportCards.columns.student"),
        cell: ({ row }) => (
          <span className="flex flex-col items-start">
            <span className="text-sm text-foreground">{row.original.student_name}</span>
            <span className="text-xs text-muted-foreground">{row.original.admission_number}</span>
          </span>
        ),
        meta: {
          headerTitle: t("reportCards.columns.student"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        // Blank for a term card, which has no result section.
        id: "section",
        enableSorting: false,
        header: () => t("reportCards.columns.section"),
        cell: ({ row }) => row.original.section_name ?? EMPTY_VALUE,
        meta: {
          headerTitle: t("reportCards.columns.section"),
          skeleton: <Skeleton className="h-4 w-12" />,
        },
      },
      {
        id: "result",
        enableSorting: false,
        header: () => t("reportCards.columns.result"),
        cell: ({ row }) => {
          const { percentage, grade } = row.original;
          if (percentage === null) return EMPTY_VALUE;
          return t("reportCards.resultValue", { percentage, grade: grade ?? EMPTY_VALUE });
        },
        meta: {
          headerTitle: t("reportCards.columns.result"),
          skeleton: <Skeleton className="h-4 w-16" />,
        },
      },
      {
        id: "version",
        enableSorting: false,
        header: () => t("reportCards.columns.version"),
        cell: ({ row }) => row.original.version.toLocaleString(),
        meta: {
          headerTitle: t("reportCards.columns.version"),
          skeleton: <Skeleton className="h-4 w-6" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("reportCards.columns.status"),
        cell: ({ row }) => <ReportCardStatusBadge status={row.original.status} />,
        meta: {
          headerTitle: t("reportCards.columns.status"),
          skeleton: <Skeleton className="h-5 w-20 rounded-full" />,
        },
      },
      {
        id: REPORT_CARD_ACTIONS_COLUMN_ID,
        header: () => <span className="sr-only">{t("reportCards.columns.actions")}</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const card = row.original;
          const name = { name: card.student_name };
          return (
            <div className="flex items-center gap-1">
              {isReportCardDownloadable(card) && (
                <Button
                  variant="primary"
                  appearance="light"
                  mode="icon"
                  shape="circle"
                  size="sm"
                  aria-label={t("reportCards.actions.downloadRow", name)}
                  disabled={downloadingId === card.id}
                  onClick={() => {
                    onDownload(card);
                  }}
                >
                  <Download className="size-4" aria-hidden="true" />
                </Button>
              )}
              {canWriteRemarks && areRemarksEditable(card) && (
                <Button
                  variant="secondary"
                  appearance="light"
                  mode="icon"
                  shape="circle"
                  size="sm"
                  aria-label={t("reportCards.actions.remarksRow", name)}
                  onClick={() => {
                    onRemarks(card);
                  }}
                >
                  <MessageSquareText className="size-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          );
        },
        meta: { skeleton: <Skeleton className="size-7 rounded-full" /> },
      },
    ],
    [t, canWriteRemarks, downloadingId, onDownload, onRemarks],
  );
}
