"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import {
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";
import { CalendarRange } from "lucide-react";

import { CursorDataGridCard } from "@/components/cursor-data-grid-card";
import { SearchInput } from "@/components/search-input";
import { SESSION_KEYS } from "@/features/school/school-permissions";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useCursorList } from "@/hooks/use-cursor-list";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { FILTER_ALL } from "@/lib/constants";
import { toOrdering } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type AcademicSessionRecord } from "@/services";
import {
  SCHOOL_ORGANIZATION_QUERY_MODULE,
  SESSION_DEFAULT_SORTING,
  SESSION_PAGE_RESOURCE,
  SESSION_PAGE_SIZE,
  SESSION_SORT_FIELD,
  SESSION_SORTABLE_IDS,
  SESSION_STATUSES,
  SESSION_URL_FILTERS,
  STRUCTURE_ACTIONS_COLUMN_ID,
} from "@/services/modules/school-organization/school-organization-constant";
import { sessionStatusFilter } from "@/services/modules/school-organization/school-organization-helper";
import { CloneSessionDialog } from "./clone-session-dialog";
import { useSessionColumns } from "./session-columns";
import { SessionFormDialog } from "./session-form-dialog";
import { SessionLifecycleDialog, type SessionLifecycleAction } from "./session-lifecycle-dialog";

/** Which dialog is open, on which session. */
type DialogTarget =
  | { kind: "edit"; session: AcademicSessionRecord }
  | { kind: "clone"; session: AcademicSessionRecord }
  | { kind: "lifecycle"; session: AcademicSessionRecord; action: SessionLifecycleAction };

/**
 * The school's academic sessions, newest first, cursor paged (the API's default paginator),
 * searched and filtered by status in the URL. Each row opens onto its terms. Edit, Activate,
 * Close and Clone follow `school.academic-session.update|activate|close|create`; each dialog is
 * mounted only while open.
 */
export function SessionsTable() {
  const t = useTranslations("school");
  const [dialog, setDialog] = useState<DialogTarget | null>(null);

  const { data: currentUser } = useCurrentUser();
  const permissions = {
    canCreate: hasPermission(currentUser, SESSION_KEYS.create),
    canUpdate: hasPermission(currentUser, SESSION_KEYS.update),
    canActivate: hasPermission(currentUser, SESSION_KEYS.activate),
    canClose: hasPermission(currentUser, SESSION_KEYS.close),
  };
  const showActions = Object.values(permissions).some(Boolean);

  // Stable, so the columns' own `useMemo` skips a rebuild on a keystroke or a page change.
  const onEdit = useCallback((session: AcademicSessionRecord) => {
    setDialog({ kind: "edit", session });
  }, []);
  const onLifecycle = useCallback(
    (session: AcademicSessionRecord, action: SessionLifecycleAction) => {
      setDialog({ kind: "lifecycle", session, action });
    },
    [],
  );
  const onClone = useCallback((session: AcademicSessionRecord) => {
    setDialog({ kind: "clone", session });
  }, []);
  const columns = useSessionColumns(permissions, { onEdit, onLifecycle, onClone });
  const hideableIds = useMemo(() => hideableColumnIds(columns), [columns]);

  const {
    filters,
    setFilters,
    searchInput,
    setSearchInput,
    search,
    sorting,
    onSortingChange,
    columnVisibility,
    onColumnVisibilityChange,
  } = useDataGridUrlState({
    filters: SESSION_URL_FILTERS,
    sortableIds: SESSION_SORTABLE_IDS,
    defaultSorting: SESSION_DEFAULT_SORTING,
    hideableIds,
    trimSearch: true,
  });
  const ordering = toOrdering(sorting, SESSION_SORT_FIELD);
  const hasActiveFilter = search !== "" || filters.status !== FILTER_ALL;

  const list = useCursorList({
    // A cursor is good only for the query that issued it: any filter or sort change starts over.
    resetKey: [search, ordering, filters.status].join("|"),
    queryKey: (cursor) =>
      queryKeys.list(SCHOOL_ORGANIZATION_QUERY_MODULE, SESSION_PAGE_RESOURCE, {
        cursor,
        search,
        ordering,
        status: filters.status,
      }),
    queryFn: (cursor) =>
      Services.schoolOrganization.fetchSessionPage({
        cursor,
        pageSize: SESSION_PAGE_SIZE,
        search: search || undefined,
        ordering,
        status: sessionStatusFilter(filters.status),
      }),
  });

  const visibility = useMemo(
    () => ({ ...columnVisibility, [STRUCTURE_ACTIONS_COLUMN_ID]: showActions }),
    [columnVisibility, showActions],
  );
  const table = useReactTable({
    data: list.rows,
    columns,
    state: { sorting, columnVisibility: visibility },
    onSortingChange,
    onColumnVisibilityChange,
    manualPagination: true,
    manualSorting: true,
    // Every session opens onto its terms (the first column's `expandedContent`).
    getRowCanExpand: () => true,
    getRowId: (session) => session.id,
    getCoreRowModel: getCoreRowModel(),
  });

  const closeDialog = (open: boolean) => {
    if (!open) setDialog(null);
  };

  return (
    <>
      <CursorDataGridCard
        list={list}
        table={table}
        caption={t("sessions.list.caption")}
        paginationLabel={t("sessions.list.pagination")}
        loadErrorMessage={t("sessions.list.loadError")}
        filters={
          <>
            <SearchInput
              value={searchInput}
              onChange={setSearchInput}
              ariaLabel={t("filters.search")}
              placeholder={t("sessions.list.searchPlaceholder")}
              clearLabel={t("filters.clearSearch")}
            />
            <Select
              value={filters.status}
              onValueChange={(status) => {
                setFilters({ status });
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label={t("filters.status")}>
                <SelectValue placeholder={t("filters.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FILTER_ALL}>{t("filters.all")}</SelectItem>
                {SESSION_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(`sessions.status.${status}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
        emptyState={
          <EmptyState
            icon={CalendarRange}
            title={t(hasActiveFilter ? "list.noMatches" : "sessions.list.emptyTitle")}
            description={t(
              hasActiveFilter ? "list.noMatchesDescription" : "sessions.list.emptyDescription",
            )}
          />
        }
      />
      {dialog?.kind === "edit" && (
        <SessionFormDialog open onOpenChange={closeDialog} record={dialog.session} />
      )}
      {dialog?.kind === "clone" && (
        <CloneSessionDialog open onOpenChange={closeDialog} source={dialog.session} />
      )}
      {dialog?.kind === "lifecycle" && (
        <SessionLifecycleDialog
          open
          onOpenChange={closeDialog}
          action={dialog.action}
          session={dialog.session}
        />
      )}
    </>
  );
}
