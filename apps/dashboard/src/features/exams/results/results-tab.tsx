"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { EmptyState } from "@schoolhub/ui";
import { Trophy } from "lucide-react";

import { CursorDataGridCard } from "@/components/cursor-data-grid-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useCursorList } from "@/hooks/use-cursor-list";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { FILTER_ALL } from "@/lib/constants";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type ExamRecord, type ResultRecord } from "@/services";
import {
  RESULT_DEFAULT_SORTING,
  RESULT_SORTABLE_IDS,
  RESULT_URL_FILTERS,
  RESULTS_LIST_RESOURCE,
  RESULTS_ORDERING,
  RESULTS_PAGE_SIZE,
  RESULTS_QUERY_MODULE,
} from "@/services/modules/exam-results/exam-results-constant";
import {
  resultOutcomeFilter,
  resultStatusFilter,
} from "@/services/modules/exam-results/exam-results-helper";
import { useResultColumns } from "./result-columns";
import { ResultDetailSheet } from "./result-detail-sheet";
import { ResultFilters } from "./result-filters";
import { ResultLifecycleBar } from "./result-lifecycle-bar";
import { WithholdResultDialog } from "./withhold-result-dialog";

/**
 * The exam's Results tab (`exams.result.view`): the processed results, highest percentage first,
 * cursor-paged and filtered by section, outcome and status in the URL. Above them the lifecycle
 * bar (process, approve, send back, publish); a student's name opens their detail sheet; a holder
 * of `exams.result.publish` may withhold a result not yet published.
 */
export function ResultsTab({ exam }: { exam: ExamRecord }) {
  const t = useTranslations("exams");
  const { data: user } = useCurrentUser();
  const canWithhold = hasPermission(user, "exams.result.publish");

  const [open, setOpen] = useState<ResultRecord | null>(null);
  const [withholding, setWithholding] = useState<ResultRecord | null>(null);
  const handleOpen = useCallback((result: ResultRecord) => {
    setOpen(result);
  }, []);
  const handleWithhold = useCallback((result: ResultRecord) => {
    setWithholding(result);
  }, []);

  const columns = useResultColumns({ canWithhold, onOpen: handleOpen, onWithhold: handleWithhold });
  const hideableIds = useMemo(() => hideableColumnIds(columns), [columns]);

  const { filters, setFilters, sorting, columnVisibility, onColumnVisibilityChange } =
    useDataGridUrlState({
      filters: RESULT_URL_FILTERS,
      sortableIds: RESULT_SORTABLE_IDS,
      defaultSorting: RESULT_DEFAULT_SORTING,
      hideableIds,
      // No search box: nothing to trim.
      trimSearch: false,
    });
  const hasActiveFilter =
    filters.section !== "" || filters.outcome !== FILTER_ALL || filters.status !== FILTER_ALL;

  const list = useCursorList({
    // A cursor is good only for the query that issued it: any filter change starts over.
    resetKey: [exam.id, filters.section, filters.outcome, filters.status].join("|"),
    queryKey: (cursor) =>
      queryKeys.list(RESULTS_QUERY_MODULE, RESULTS_LIST_RESOURCE, {
        examId: exam.id,
        cursor,
        section: filters.section,
        outcome: filters.outcome,
        status: filters.status,
      }),
    queryFn: (cursor) =>
      Services.examResults.fetchResultsPage({
        examId: exam.id,
        cursor,
        pageSize: RESULTS_PAGE_SIZE,
        ordering: RESULTS_ORDERING,
        sectionId: filters.section || undefined,
        outcome: resultOutcomeFilter(filters.outcome),
        status: resultStatusFilter(filters.status),
      }),
  });

  const table = useReactTable({
    data: list.rows,
    columns,
    state: { sorting, columnVisibility },
    onColumnVisibilityChange,
    manualPagination: true,
    manualSorting: true,
    getRowId: (result) => result.id,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="space-y-4">
      <ResultLifecycleBar exam={exam} />
      <CursorDataGridCard
        list={list}
        table={table}
        caption={t("results.caption")}
        paginationLabel={t("results.pagination")}
        loadErrorMessage={t("results.loadError")}
        filters={<ResultFilters examId={exam.id} values={filters} onChange={setFilters} />}
        emptyState={
          <EmptyState
            icon={Trophy}
            title={t(hasActiveFilter ? "results.noMatches" : "results.emptyTitle")}
            description={t(
              hasActiveFilter ? "results.noMatchesDescription" : "results.emptyDescription",
            )}
          />
        }
      />
      <ResultDetailSheet
        examId={exam.id}
        result={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) setOpen(null);
        }}
      />
      {withholding && (
        <WithholdResultDialog
          onOpenChange={(isOpen) => {
            if (!isOpen) setWithholding(null);
          }}
          result={withholding}
        />
      )}
    </div>
  );
}
