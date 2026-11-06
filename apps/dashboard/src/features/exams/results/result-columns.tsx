"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Skeleton } from "@schoolhub/ui";
import { Ban } from "lucide-react";

import { EMPTY_VALUE } from "@/lib/constants";
import type { ResultRecord } from "@/services";
import { RESULT_ACTIONS_COLUMN_ID } from "@/services/modules/exam-results/exam-results-constant";
import { mayWithholdResult } from "@/services/modules/exam-results/exam-results-helper";
import { ResultOutcomeBadge, ResultStatusBadge } from "./result-badges";

export interface ResultColumnsOptions {
  /** `exams.result.publish`: Withhold shows on a result not yet published or withheld. */
  canWithhold: boolean;
  /** Both must be `useCallback`-stable, or the columns rebuild on every render. */
  onOpen: (result: ResultRecord) => void;
  onWithhold: (result: ResultRecord) => void;
}

/** A plain text column with no sort: the header and its skeleton. */
function textColumn(
  id: string,
  header: string,
  cell: (result: ResultRecord) => string,
  skeletonWidth: string,
): ColumnDef<ResultRecord> {
  return {
    id,
    enableSorting: false,
    header: () => header,
    cell: ({ row }) => cell(row.original),
    meta: { headerTitle: header, skeleton: <Skeleton className={`h-4 ${skeletonWidth}`} /> },
  };
}

/**
 * The Results tab's columns: rank in section, student (opens the detail sheet), section,
 * percentage, grade, GPA, outcome, status and the row's Withhold. Every figure is the server's.
 */
export function useResultColumns({
  canWithhold,
  onOpen,
  onWithhold,
}: ResultColumnsOptions): ColumnDef<ResultRecord>[] {
  const t = useTranslations("exams");

  return useMemo<ColumnDef<ResultRecord>[]>(
    () => [
      textColumn(
        "rank",
        t("results.columns.rank"),
        (result) => result.rank_in_section?.toLocaleString() ?? EMPTY_VALUE,
        "w-8",
      ),
      {
        id: "student",
        enableSorting: false,
        header: () => t("results.columns.student"),
        cell: ({ row }) => {
          const result = row.original;
          return (
            <span className="flex flex-col items-start">
              <Button
                variant="primary"
                mode="link"
                onClick={() => {
                  onOpen(result);
                }}
              >
                {result.student_name}
              </Button>
              <span className="text-xs text-muted-foreground">{result.admission_number}</span>
            </span>
          );
        },
        meta: {
          headerTitle: t("results.columns.student"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      textColumn("section", t("results.columns.section"), (result) => result.section_name, "w-12"),
      textColumn(
        "percentage",
        t("results.columns.percentage"),
        (result) => t("results.percent", { value: result.percentage }),
        "w-14",
      ),
      textColumn("grade", t("results.columns.grade"), (result) => result.grade, "w-8"),
      textColumn("gpa", t("results.columns.gpa"), (result) => result.gpa ?? EMPTY_VALUE, "w-10"),
      {
        id: "outcome",
        enableSorting: false,
        header: () => t("results.columns.outcome"),
        cell: ({ row }) => <ResultOutcomeBadge outcome={row.original.outcome} />,
        meta: {
          headerTitle: t("results.columns.outcome"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("results.columns.status"),
        cell: ({ row }) => <ResultStatusBadge status={row.original.status} />,
        meta: {
          headerTitle: t("results.columns.status"),
          skeleton: <Skeleton className="h-5 w-24 rounded-full" />,
        },
      },
      {
        id: RESULT_ACTIONS_COLUMN_ID,
        header: () => <span className="sr-only">{t("results.columns.actions")}</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const result = row.original;
          if (!canWithhold || !mayWithholdResult(result)) return null;
          return (
            <Button
              variant="destructive"
              appearance="light"
              mode="icon"
              shape="circle"
              size="sm"
              aria-label={t("results.actions.withholdRow", { name: result.student_name })}
              onClick={() => {
                onWithhold(result);
              }}
            >
              <Ban className="size-4" aria-hidden="true" />
            </Button>
          );
        },
        meta: { skeleton: <Skeleton className="size-7 rounded-full" /> },
      },
    ],
    [t, canWithhold, onOpen, onWithhold],
  );
}
