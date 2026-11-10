"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { EmptyState } from "@schoolhub/ui";
import { FileText } from "lucide-react";

import { CursorDataGridCard } from "@/components/cursor-data-grid-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useCursorList } from "@/hooks/use-cursor-list";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { FILTER_ALL } from "@/lib/constants";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type ExamRecord, type ReportCardRecord } from "@/services";
import {
  REPORT_CARD_DEFAULT_SORTING,
  REPORT_CARD_SORTABLE_IDS,
  REPORT_CARD_URL_FILTERS,
  REPORT_CARDS_LIST_RESOURCE,
  REPORT_CARDS_ORDERING,
  REPORT_CARDS_PAGE_SIZE,
  REPORT_CARDS_QUERY_MODULE,
} from "@/services/modules/report-cards/report-cards-constant";
import {
  reportCardFilename,
  reportCardStatusFilter,
  writableRemarkFields,
} from "@/services/modules/report-cards/report-cards-helper";
import { useCardDownload } from "@/features/exams/use-card-download";
import { RemarksDialog } from "./remarks-dialog";
import { ReportCardActions } from "./report-card-actions";
import { useReportCardColumns } from "./report-card-columns";
import { ReportCardFilters } from "./report-card-filters";

/**
 * The exam's Report cards tab (`exams.report-card.view`): its cards, newest first, cursor-paged and
 * filtered by section and status in the URL. Download fetches the card's own signed link
 * (`:download`) once its PDF exists. Remarks shows only the fields the viewer may write; Generate
 * and Publish sit above the list once the exam's results are published.
 */
export function ReportCardsTab({ exam }: { exam: ExamRecord }) {
  const t = useTranslations("exams");
  const { data: user } = useCurrentUser();
  const remarkFields = useMemo(
    () => writableRemarkFields((key) => hasPermission(user, key)),
    [user],
  );

  const [editingRemarks, setEditingRemarks] = useState<ReportCardRecord | null>(null);
  const handleRemarks = useCallback((card: ReportCardRecord) => {
    setEditingRemarks(card);
  }, []);

  const { download: handleDownload, downloadingId } = useCardDownload({
    fetchUrl: (id) => Services.reportCards.fetchReportCardDownloadUrl(id),
    filename: reportCardFilename,
    failedMessage: t("reportCards.download.failed"),
  });

  const columns = useReportCardColumns({
    canWriteRemarks: remarkFields.length > 0,
    downloadingId,
    onDownload: handleDownload,
    onRemarks: handleRemarks,
  });
  const hideableIds = useMemo(() => hideableColumnIds(columns), [columns]);

  const { filters, setFilters, sorting, columnVisibility, onColumnVisibilityChange } =
    useDataGridUrlState({
      filters: REPORT_CARD_URL_FILTERS,
      sortableIds: REPORT_CARD_SORTABLE_IDS,
      defaultSorting: REPORT_CARD_DEFAULT_SORTING,
      hideableIds,
      // No search box: nothing to trim.
      trimSearch: false,
    });
  const hasActiveFilter = filters.section !== "" || filters.status !== FILTER_ALL;

  const list = useCursorList({
    // A cursor is good only for the query that issued it: any filter change starts over.
    resetKey: [exam.id, filters.section, filters.status].join("|"),
    queryKey: (cursor) =>
      queryKeys.list(REPORT_CARDS_QUERY_MODULE, REPORT_CARDS_LIST_RESOURCE, {
        examId: exam.id,
        cursor,
        section: filters.section,
        status: filters.status,
      }),
    queryFn: (cursor) =>
      Services.reportCards.fetchReportCardsPage({
        examId: exam.id,
        cursor,
        pageSize: REPORT_CARDS_PAGE_SIZE,
        ordering: REPORT_CARDS_ORDERING,
        sectionId: filters.section || undefined,
        status: reportCardStatusFilter(filters.status),
      }),
  });

  const table = useReactTable({
    data: list.rows,
    columns,
    state: { sorting, columnVisibility },
    onColumnVisibilityChange,
    manualPagination: true,
    manualSorting: true,
    getRowId: (card) => card.id,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="space-y-4">
      <ReportCardActions exam={exam} />
      <CursorDataGridCard
        list={list}
        table={table}
        caption={t("reportCards.caption")}
        paginationLabel={t("reportCards.pagination")}
        loadErrorMessage={t("reportCards.loadError")}
        filters={<ReportCardFilters examId={exam.id} values={filters} onChange={setFilters} />}
        emptyState={
          <EmptyState
            icon={FileText}
            title={t(hasActiveFilter ? "reportCards.noMatches" : "reportCards.emptyTitle")}
            description={t(
              hasActiveFilter ? "reportCards.noMatchesDescription" : "reportCards.emptyDescription",
            )}
          />
        }
      />
      {editingRemarks && (
        <RemarksDialog
          onOpenChange={(open) => {
            if (!open) setEditingRemarks(null);
          }}
          card={editingRemarks}
          fields={remarkFields}
        />
      )}
    </div>
  );
}
