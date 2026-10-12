"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ColumnDef,
  OnChangeFn,
  PaginationState,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";
import { DATA_GRID_PAGE_SIZES } from "@schoolhub/ui";

import {
  DEFAULT_LIST_PAGE_SIZE,
  LIST_URL_KEYS,
  SEARCH_DEBOUNCE_MS,
  SORT_NONE,
} from "@/lib/constants";
import { Regex } from "@/lib/regex";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useUrlParams, type UrlParamUpdates } from "@/hooks/use-url-params";

/** One URL filter: the value it takes when absent or invalid, and what counts as valid. */
export interface FilterSpec {
  default: string;
  isValid: (value: string) => boolean;
}

export interface DataGridUrlStateOptions<F extends string> {
  /** URL key -> spec. Pass a module-level constant: its identity is a memo dependency. */
  filters: Record<F, FilterSpec>;
  /** Column ids `sort` may name (a `-` prefix means descending). */
  sortableIds: readonly string[];
  /** Sort when `sort` is absent. Module-level constant, like `filters`. */
  defaultSorting: SortingState;
  /** Column ids `hidden` may name — derive with `hideableColumnIds`. */
  hideableIds: readonly string[];
  /** Whether the search text is trimmed before it is written and sent. */
  trimSearch: boolean;
}

const LIST_SEPARATOR = ",";
const DESCENDING_PREFIX = "-";

/** A column def's id by TanStack's own rule: `id`, else the accessor key with dots as
 * underscores, else a string header. */
function columnId<T>(column: ColumnDef<T>): string | undefined {
  if (column.id) return column.id;
  if ("accessorKey" in column) return String(column.accessorKey).replaceAll(".", "_");
  return typeof column.header === "string" ? column.header : undefined;
}

/** Ids of the columns a viewer may hide (`enableHiding !== false`), from the column defs. */
export function hideableColumnIds<T>(columns: readonly ColumnDef<T>[]): string[] {
  return columns.flatMap((column) => {
    const id = column.enableHiding === false ? undefined : columnId(column);
    return id === undefined ? [] : [id];
  });
}

function splitList(value: string | null): string[] {
  return (value ?? "").split(LIST_SEPARATOR).filter(Boolean);
}

/** The live address, for callbacks: always current, even between two writes in one tick. */
function liveParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function parseFilters<F extends string>(
  params: URLSearchParams,
  specs: Record<F, FilterSpec>,
): Record<F, string> {
  const result = {} as Record<F, string>;
  for (const key of Object.keys(specs) as F[]) {
    const raw = params.get(key);
    result[key] = raw !== null && specs[key].isValid(raw) ? raw : specs[key].default;
  }
  return result;
}

function parseSorting(
  raw: string | null,
  sortableIds: readonly string[],
  defaultSorting: SortingState,
): SortingState {
  if (raw === null) return defaultSorting;
  if (raw === SORT_NONE) return [];
  const desc = raw.startsWith(DESCENDING_PREFIX);
  const id = desc ? raw.slice(DESCENDING_PREFIX.length) : raw;
  return sortableIds.includes(id) ? [{ id, desc }] : defaultSorting;
}

/** `null` (omit the key) for the default sort; `SORT_NONE` when cleared but the default isn't. */
function serializeSorting(next: SortingState, defaultSorting: SortingState): string | null {
  const first = next[0];
  const fallback = defaultSorting[0];
  if (!first) return fallback ? SORT_NONE : null;
  if (fallback && first.id === fallback.id && first.desc === fallback.desc) return null;
  return `${first.desc ? DESCENDING_PREFIX : ""}${first.id}`;
}

function parsePagination(page: string | null, pageSize: string | null): PaginationState {
  const size = Number(pageSize);
  return {
    pageIndex: page !== null && Regex.POSITIVE_INTEGER.test(page) ? Number(page) - 1 : 0,
    pageSize: DATA_GRID_PAGE_SIZES.some((allowed) => allowed === size)
      ? size
      : DEFAULT_LIST_PAGE_SIZE,
  };
}

/** Page 1 is the absence of the key, so a link to the first page reads like the list. */
function pageParam(pageIndex: number): string | null {
  return pageIndex > 0 ? String(pageIndex + 1) : null;
}

function parseVisibility(raw: string | null, hideableIds: readonly string[]): VisibilityState {
  const hidden = splitList(raw).filter((id) => hideableIds.includes(id));
  return Object.fromEntries(hidden.map((id) => [id, false]));
}

/**
 * A `DataGrid` list's search, filters, sort, page, page size and hidden columns, kept in
 * the query string so a reload keeps the view and a link shares it. Values outside the
 * known set fall back to the default; anything that changes which rows match (search, a
 * filter, the sort, the page size) sends the list back to page 1.
 *
 * Every callback is stable and reads the live URL, so TanStack can hold them and two
 * changes in one tick both land.
 */
export function useDataGridUrlState<F extends string>({
  filters: filterSpecs,
  sortableIds,
  defaultSorting,
  hideableIds,
  trimSearch,
}: DataGridUrlStateOptions<F>) {
  const { searchParams, setParams } = useUrlParams();

  // Keyed on the joined ids, so a caller passing a fresh array each render costs nothing.
  const sortableKey = sortableIds.join(LIST_SEPARATOR);
  const hideableKey = hideableIds.join(LIST_SEPARATOR);
  const sortable = useMemo(() => splitList(sortableKey), [sortableKey]);
  const hideable = useMemo(() => splitList(hideableKey), [hideableKey]);

  const filters = useMemo(
    () => parseFilters(searchParams, filterSpecs),
    [searchParams, filterSpecs],
  );
  const sortValue = searchParams.get(LIST_URL_KEYS.sort);
  const sorting = useMemo(
    () => parseSorting(sortValue, sortable, defaultSorting),
    [sortValue, sortable, defaultSorting],
  );
  const pageValue = searchParams.get(LIST_URL_KEYS.page);
  const pageSizeValue = searchParams.get(LIST_URL_KEYS.pageSize);
  const pagination = useMemo(
    () => parsePagination(pageValue, pageSizeValue),
    [pageValue, pageSizeValue],
  );
  const hiddenValue = searchParams.get(LIST_URL_KEYS.hidden);
  const columnVisibility = useMemo(
    () => parseVisibility(hiddenValue, hideable),
    [hiddenValue, hideable],
  );

  // Search: the box is local state so typing never waits on the URL; the debounced value
  // is what gets written, and what the URL says is what gets sent.
  const urlSearch = searchParams.get(LIST_URL_KEYS.search) ?? "";
  const search = trimSearch ? urlSearch.trim() : urlSearch;
  const [searchInput, setSearchInput] = useState(urlSearch);
  const [syncedSearch, setSyncedSearch] = useState(urlSearch);
  const [syncedQuery, setSyncedQuery] = useState(searchParams.toString());
  const debouncedInput = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  const debouncedSearch = trimSearch ? debouncedInput.trim() : debouncedInput;

  // The query changed. Unless it is this hook's own search write landing (the search now
  // equals the debounced value), it came from outside (Back, a sidebar link): the box
  // adopts the URL's search, which also restarts the debounce, so typed-but-unwritten
  // text is never written over the new address.
  const query = searchParams.toString();
  if (query !== syncedQuery) {
    setSyncedQuery(query);
    setSyncedSearch(urlSearch);
    const ownSearchWrite = urlSearch !== syncedSearch && search === debouncedSearch;
    const typed = trimSearch ? searchInput.trim() : searchInput;
    if (!ownSearchWrite && typed !== search) setSearchInput(urlSearch);
  }

  // Depends only on the debounced value: an outside URL change must not trigger a write.
  // The live-URL check makes the mount (and a value already there) a no-op, so a cold
  // load keeps its `page`.
  useEffect(() => {
    const current = liveParams().get(LIST_URL_KEYS.search) ?? "";
    if (debouncedSearch === (trimSearch ? current.trim() : current)) return;
    setParams({
      [LIST_URL_KEYS.search]: debouncedSearch === "" ? null : debouncedSearch,
      [LIST_URL_KEYS.page]: null,
    });
  }, [debouncedSearch, trimSearch, setParams]);

  const setFilters = useCallback(
    (updates: Partial<Record<F, string>>) => {
      const writes: UrlParamUpdates = { [LIST_URL_KEYS.page]: null };
      for (const key of Object.keys(updates) as F[]) {
        const value = updates[key];
        if (value !== undefined) writes[key] = value === filterSpecs[key].default ? null : value;
      }
      setParams(writes);
    },
    [filterSpecs, setParams],
  );

  const onSortingChange = useCallback<OnChangeFn<SortingState>>(
    (updater) => {
      const current = parseSorting(liveParams().get(LIST_URL_KEYS.sort), sortable, defaultSorting);
      const next = typeof updater === "function" ? updater(current) : updater;
      setParams({
        [LIST_URL_KEYS.sort]: serializeSorting(next, defaultSorting),
        [LIST_URL_KEYS.page]: null,
      });
    },
    [sortable, defaultSorting, setParams],
  );

  const onPaginationChange = useCallback<OnChangeFn<PaginationState>>(
    (updater) => {
      const live = liveParams();
      const current = parsePagination(
        live.get(LIST_URL_KEYS.page),
        live.get(LIST_URL_KEYS.pageSize),
      );
      const next = typeof updater === "function" ? updater(current) : updater;
      if (next.pageSize !== current.pageSize) {
        // TanStack moves the page index in the same update to keep the top row in view;
        // a new page size starts at page 1 instead, so that index is dropped.
        setParams({
          [LIST_URL_KEYS.pageSize]:
            next.pageSize === DEFAULT_LIST_PAGE_SIZE ? null : String(next.pageSize),
          [LIST_URL_KEYS.page]: null,
        });
      } else if (next.pageIndex !== current.pageIndex) {
        setParams({ [LIST_URL_KEYS.page]: pageParam(next.pageIndex) });
      }
    },
    [setParams],
  );

  const setPageIndex = useCallback(
    (pageIndex: number) => {
      setParams({ [LIST_URL_KEYS.page]: pageParam(pageIndex) });
    },
    [setParams],
  );

  const onColumnVisibilityChange = useCallback<OnChangeFn<VisibilityState>>(
    (updater) => {
      const current = parseVisibility(liveParams().get(LIST_URL_KEYS.hidden), hideable);
      const next = typeof updater === "function" ? updater(current) : updater;
      const hidden = hideable.filter((id) => next[id] === false);
      setParams({ [LIST_URL_KEYS.hidden]: hidden.length > 0 ? hidden.join(LIST_SEPARATOR) : null });
    },
    [hideable, setParams],
  );

  return {
    filters,
    setFilters,
    searchInput,
    setSearchInput,
    search,
    sorting,
    onSortingChange,
    pagination,
    onPaginationChange,
    columnVisibility,
    onColumnVisibilityChange,
    setPageIndex,
  };
}
