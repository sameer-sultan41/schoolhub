"use client";

import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { isOffsetPagination } from "@schoolhub/types";

import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { usePageClamp } from "@/hooks/use-page-clamp";
import { FILTER_ALL } from "@/lib/constants";
import { localDateToIso, localDayEndToIso } from "@/lib/date-time-input";
import { toOrdering } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services, type ContactSubmissionRecord } from "@/services";
import {
  CONTACT_SORT_FIELD,
  CONTACT_SUBMISSION_STATUSES,
  CONTACT_SUBMISSIONS_RESOURCE,
  CONTACT_URL_FILTERS,
} from "@/services/modules/website/contact-submissions/contact-submissions-constant";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";

/** No sort in the URL means the server's own order: newest first. */
const SERVER_ORDER: SortingState = [];
const SORTABLE_IDS = Object.keys(CONTACT_SORT_FIELD);

export type ContactInboxFilters = Record<keyof typeof CONTACT_URL_FILTERS, string>;

/**
 * The inbox's list state: search, status, the received-date range, sort, page and hidden columns
 * in the URL; the server-paginated read with the page clamp and stale-page reset; and the table.
 * The dates are the viewer's local days, sent as an inclusive range of instants.
 */
export function useContactInbox(columns: ColumnDef<ContactSubmissionRecord>[]) {
  const hideableIds = useMemo(() => hideableColumnIds(columns), [columns]);
  const urlState = useDataGridUrlState({
    filters: CONTACT_URL_FILTERS,
    sortableIds: SORTABLE_IDS,
    defaultSorting: SERVER_ORDER,
    hideableIds,
    trimSearch: true,
  });
  const { search, sorting, pagination, columnVisibility, filters, setPageIndex } = urlState;

  const ordering = toOrdering(sorting, CONTACT_SORT_FIELD);
  const page = pagination.pageIndex + 1;
  const pageSize = pagination.pageSize;
  const status = CONTACT_SUBMISSION_STATUSES.find((value) => value === filters.status);
  const createdFrom = localDateToIso(filters.from) ?? undefined;
  const createdTo = localDayEndToIso(filters.to) ?? undefined;
  const params = { page, pageSize, search, ordering, status, createdFrom, createdTo };

  const query = useQuery({
    queryKey: queryKeys.list(WEBSITE_QUERY_MODULE, CONTACT_SUBMISSIONS_RESOURCE, params),
    queryFn: () =>
      Services.contactSubmissions.fetchContactSubmissionPage({
        ...params,
        search: search || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const pageMeta = query.data?.pagination;
  const totalCount = pageMeta && isOffsetPagination(pageMeta) ? pageMeta.total_count : 0;
  const { pageCount, isStalePage } = usePageClamp({
    pageMeta,
    isPlaceholderData: query.isPlaceholderData,
    error: query.error,
    pageIndex: pagination.pageIndex,
    setPageIndex,
  });

  const rows = useMemo(() => query.data?.items ?? [], [query.data]);
  const table = useReactTable({
    data: rows,
    columns,
    pageCount,
    state: { pagination, sorting, columnVisibility },
    onPaginationChange: urlState.onPaginationChange,
    onSortingChange: urlState.onSortingChange,
    onColumnVisibilityChange: urlState.onColumnVisibilityChange,
    manualPagination: true,
    manualSorting: true,
    getRowId: (record) => record.id,
    getCoreRowModel: getCoreRowModel(),
  });

  return {
    table,
    query,
    totalCount,
    isStalePage,
    hasActiveFilter:
      search !== "" || status !== undefined || filters.from !== "" || filters.to !== "",
    searchInput: urlState.searchInput,
    setSearchInput: urlState.setSearchInput,
    filters,
    setFilters: (updates: Partial<ContactInboxFilters>) => {
      urlState.setFilters({
        ...updates,
        ...(updates.status !== undefined ? { status: updates.status || FILTER_ALL } : {}),
      });
    },
  };
}

export type ContactInbox = ReturnType<typeof useContactInbox>;
