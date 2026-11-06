"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { EmptyState } from "@schoolhub/ui";
import { FileQuestion } from "lucide-react";

import { CursorDataGridCard } from "@/components/cursor-data-grid-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useCursorList } from "@/hooks/use-cursor-list";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { FILTER_ALL } from "@/lib/constants";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type QuestionRecord } from "@/services";
import {
  QUESTION_BANKS_QUERY_MODULE,
  QUESTIONS_DEFAULT_SORTING,
  QUESTIONS_LIST_RESOURCE,
  QUESTIONS_ORDERING,
  QUESTIONS_PAGE_SIZE,
  QUESTIONS_SORTABLE_IDS,
  QUESTIONS_URL_FILTERS,
} from "@/services/modules/question-banks/question-banks-constant";
import {
  approvalFilterToFlag,
  difficultyFilter,
  sourceFilter,
  typeFilter,
} from "@/services/modules/question-banks/question-banks-helper";
import { ApproveQuestionDialog } from "./approve-question-dialog";
import { DeleteQuestionDialog } from "./delete-question-dialog";
import { useQuestionColumns } from "./question-columns";
import { QuestionFilters } from "./question-filters";
import { QuestionFormDialog } from "./question-form-dialog";

/**
 * A bank's questions, cursor-paged in the bank's own order and filtered in the URL by topic,
 * difficulty, type, source and approval. Edit and Remove follow the bank keys; Approve (an AI
 * draft only, `exams.question.approve`) is the human gate invariant 5 asks for: it confirms over
 * the whole question first, and the row keeps the AI label after it. Each dialog is mounted only
 * while open.
 */
export function QuestionsTable({ bankId }: { bankId: string }) {
  const t = useTranslations("exams");

  const [editTarget, setEditTarget] = useState<QuestionRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QuestionRecord | null>(null);
  const [approveTarget, setApproveTarget] = useState<QuestionRecord | null>(null);

  const { data: user } = useCurrentUser();
  const canUpdate = hasPermission(user, "exams.question-bank.update");
  const canDelete = hasPermission(user, "exams.question-bank.delete");
  const canApprove = hasPermission(user, "exams.question.approve");

  // Stable, so the columns' own `useMemo` skips a rebuild on a keystroke or a page change.
  const handleEdit = useCallback((question: QuestionRecord) => {
    setEditTarget(question);
  }, []);
  const handleRemove = useCallback((question: QuestionRecord) => {
    setDeleteTarget(question);
  }, []);
  const handleApprove = useCallback((question: QuestionRecord) => {
    setApproveTarget(question);
  }, []);

  const columns = useQuestionColumns({
    canUpdate,
    canDelete,
    canApprove,
    onEdit: handleEdit,
    onRemove: handleRemove,
    onApprove: handleApprove,
  });
  const hideableIds = useMemo(() => hideableColumnIds(columns), [columns]);

  const {
    filters,
    setFilters,
    searchInput,
    setSearchInput,
    search,
    sorting,
    columnVisibility,
    onColumnVisibilityChange,
  } = useDataGridUrlState({
    filters: QUESTIONS_URL_FILTERS,
    sortableIds: QUESTIONS_SORTABLE_IDS,
    defaultSorting: QUESTIONS_DEFAULT_SORTING,
    hideableIds,
    trimSearch: true,
  });
  const pickedFilters = [filters.difficulty, filters.type, filters.source, filters.approved];
  const hasActiveFilter =
    search !== "" || filters.topic !== "" || pickedFilters.some((value) => value !== FILTER_ALL);

  const list = useCursorList({
    // A cursor is good only for the query that issued it: any filter change starts over.
    resetKey: [
      bankId,
      search,
      filters.topic,
      filters.difficulty,
      filters.type,
      filters.source,
      filters.approved,
    ].join("|"),
    queryKey: (cursor) =>
      queryKeys.list(QUESTION_BANKS_QUERY_MODULE, QUESTIONS_LIST_RESOURCE, {
        bankId,
        cursor,
        search,
        ...filters,
      }),
    queryFn: (cursor) =>
      Services.questionBanks.fetchQuestionsPage({
        bankId,
        cursor,
        pageSize: QUESTIONS_PAGE_SIZE,
        ordering: QUESTIONS_ORDERING,
        search: search || undefined,
        topic: filters.topic || undefined,
        difficulty: difficultyFilter(filters.difficulty),
        questionType: typeFilter(filters.type),
        source: sourceFilter(filters.source),
        isApproved: approvalFilterToFlag(filters.approved),
      }),
  });

  const table = useReactTable({
    data: list.rows,
    columns,
    state: { sorting, columnVisibility },
    onColumnVisibilityChange,
    manualPagination: true,
    manualSorting: true,
    getRowId: (question) => question.id,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <>
      <CursorDataGridCard
        list={list}
        table={table}
        caption={t("questionBanks.questions.caption")}
        paginationLabel={t("questionBanks.questions.pagination")}
        loadErrorMessage={t("questionBanks.questions.loadError")}
        filters={
          <QuestionFilters
            searchInput={searchInput}
            onSearchInputChange={setSearchInput}
            values={filters}
            onChange={setFilters}
          />
        }
        emptyState={
          <EmptyState
            icon={FileQuestion}
            title={t(
              hasActiveFilter
                ? "questionBanks.questions.noMatches"
                : "questionBanks.questions.emptyTitle",
            )}
            description={t(
              hasActiveFilter
                ? "questionBanks.questions.noMatchesDescription"
                : "questionBanks.questions.emptyDescription",
            )}
          />
        }
      />
      {editTarget && (
        <QuestionFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          bankId={bankId}
          record={editTarget}
        />
      )}
      {deleteTarget && (
        <DeleteQuestionDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          bankId={bankId}
          question={deleteTarget}
        />
      )}
      {approveTarget && (
        <ApproveQuestionDialog
          open
          onOpenChange={(open) => {
            if (!open) setApproveTarget(null);
          }}
          bankId={bankId}
          question={approveTarget}
        />
      )}
    </>
  );
}
