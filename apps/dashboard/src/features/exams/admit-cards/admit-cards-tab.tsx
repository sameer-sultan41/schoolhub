"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { EmptyState } from "@schoolhub/ui";
import { IdCard } from "lucide-react";

import { CursorDataGridCard } from "@/components/cursor-data-grid-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useCursorList } from "@/hooks/use-cursor-list";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { FILTER_ALL } from "@/lib/constants";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type AdmitCardRecord, type ExamRecord } from "@/services";
import {
  ADMIT_CARD_DEFAULT_SORTING,
  ADMIT_CARD_SORTABLE_IDS,
  ADMIT_CARD_URL_FILTERS,
  ADMIT_CARDS_LIST_RESOURCE,
  ADMIT_CARDS_ORDERING,
  ADMIT_CARDS_PAGE_SIZE,
  ADMIT_CARDS_QUERY_MODULE,
} from "@/services/modules/admit-cards/admit-cards-constant";
import {
  admitCardFilename,
  isExamIssuable,
  statusFilterToStatus,
} from "@/services/modules/admit-cards/admit-cards-helper";
import { useCardDownload } from "@/features/exams/use-card-download";
import { useAdmitCardColumns } from "./admit-card-columns";
import { AdmitCardFilters } from "./admit-card-filters";
import { IssueAdmitCardsButton } from "./issue-admit-cards-button";
import { RevokeAdmitCardDialog } from "./revoke-admit-card-dialog";

/**
 * The exam's Admit cards tab (`exams.admit-card.view`): its cards by number, cursor-paged and
 * filtered by section and status in the URL. Download fetches the card's own signed link
 * (`:download`) once its PDF exists, on a card not revoked. A holder of `exams.admit-card.issue`
 * gets Issue admit cards once the schedule is published, and Revoke (with a reason) on a live card.
 */
export function AdmitCardsTab({ exam }: { exam: ExamRecord }) {
  const t = useTranslations("exams");
  const { data: user } = useCurrentUser();
  const canIssue = hasPermission(user, "exams.admit-card.issue");
  const issuable = isExamIssuable(exam.status);

  const [revoking, setRevoking] = useState<AdmitCardRecord | null>(null);
  const handleRevoke = useCallback((card: AdmitCardRecord) => {
    setRevoking(card);
  }, []);

  const { download: handleDownload, downloadingId } = useCardDownload({
    fetchUrl: (id) => Services.admitCards.fetchAdmitCardDownloadUrl(id),
    filename: admitCardFilename,
    failedMessage: t("admitCards.download.failed"),
  });

  const columns = useAdmitCardColumns({
    canRevoke: canIssue,
    downloadingId,
    onDownload: handleDownload,
    onRevoke: handleRevoke,
  });
  const hideableIds = useMemo(() => hideableColumnIds(columns), [columns]);

  const { filters, setFilters, sorting, columnVisibility, onColumnVisibilityChange } =
    useDataGridUrlState({
      filters: ADMIT_CARD_URL_FILTERS,
      sortableIds: ADMIT_CARD_SORTABLE_IDS,
      defaultSorting: ADMIT_CARD_DEFAULT_SORTING,
      hideableIds,
      // No search box: nothing to trim.
      trimSearch: false,
    });
  const hasActiveFilter = filters.section !== "" || filters.status !== FILTER_ALL;

  const list = useCursorList({
    // A cursor is good only for the query that issued it: any filter change starts over.
    resetKey: [exam.id, filters.section, filters.status].join("|"),
    queryKey: (cursor) =>
      queryKeys.list(ADMIT_CARDS_QUERY_MODULE, ADMIT_CARDS_LIST_RESOURCE, {
        examId: exam.id,
        cursor,
        section: filters.section,
        status: filters.status,
      }),
    queryFn: (cursor) =>
      Services.admitCards.fetchAdmitCardsPage({
        examId: exam.id,
        cursor,
        pageSize: ADMIT_CARDS_PAGE_SIZE,
        ordering: ADMIT_CARDS_ORDERING,
        sectionId: filters.section || undefined,
        status: statusFilterToStatus(filters.status),
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

  let emptyDescription = t("admitCards.emptyDraft");
  if (hasActiveFilter) emptyDescription = t("admitCards.noMatchesDescription");
  else if (issuable) emptyDescription = t("admitCards.emptyDescription");

  return (
    <div className="space-y-4">
      {canIssue && issuable && <IssueAdmitCardsButton exam={exam} />}
      <CursorDataGridCard
        list={list}
        table={table}
        caption={t("admitCards.caption")}
        paginationLabel={t("admitCards.pagination")}
        loadErrorMessage={t("admitCards.loadError")}
        filters={<AdmitCardFilters examId={exam.id} values={filters} onChange={setFilters} />}
        emptyState={
          <EmptyState
            icon={IdCard}
            title={t(hasActiveFilter ? "admitCards.noMatches" : "admitCards.emptyTitle")}
            description={emptyDescription}
          />
        }
      />
      {revoking && (
        <RevokeAdmitCardDialog
          open
          onOpenChange={(open) => {
            if (!open) setRevoking(null);
          }}
          card={revoking}
        />
      )}
    </div>
  );
}
