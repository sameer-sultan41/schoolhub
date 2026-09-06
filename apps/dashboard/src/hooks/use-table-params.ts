"use client";

import { useMemo } from "react";
import type { DataTableSort } from "@schoolhub/ui";
import { ALL_FILTER_VALUE } from "@/components/filter-bar";
import { useSearchParam } from "@/hooks/use-search-param";

export interface UseTableParamsOptions<TFilter extends string> {
  /** Filter names, used as both the URL key and the API query key. */
  filterKeys: readonly TFilter[];
  /** Whether this list takes a free-text `search`. */
  searchable?: boolean;
  pageSize: number;
  /**
   * Translated labels for the sort controls. Supplying them is what turns sorting on:
   * a table whose endpoint declares no useful `ordering_fields` simply omits this and
   * gets no `sort` back to pass on.
   *
   * They live here rather than at the call site because the hook returns the finished
   * `DataTableSort`. Assembling it from parts at seven call sites is how the first
   * version shipped a spread that silently dropped both labels — the table rendered,
   * then threw the moment anyone clicked a header.
   */
  sortLabels?: {
    ascending: (column: string) => string;
    descending: (column: string) => string;
  };
}

/**
 * One table's filters, sort and page size, held in the URL.
 *
 * Every list screen in this app reaches for the same four things and used to spell them
 * differently — a `useState` per filter, a bespoke `filters` memo, a `clear` that had to
 * remember every setter, and the page size hardcoded into the query. This hook is that
 * shape once, so the tables are consistent by construction rather than by nine people
 * remembering to match; it is the same composition layer the LinkedUnion dashboard has
 * as `useDataTable`.
 *
 * State goes in the URL, not `useState`, so a filtered list is a link: shareable,
 * bookmarkable, and intact after a refresh or a Back press. See `useSearchParam`.
 *
 * `query` is the point of the whole thing: the request params, already assembled.
 * Filters sitting at "all" are omitted rather than sent as a sentinel, `sort_by` and
 * `sort_type` are folded into the single `ordering` field DRF expects (leading `-` for
 * descending), and `page_size` is always present. Spread it into the request and the
 * caller never restates any of that.
 *
 * The cursor is deliberately NOT here — it belongs to `useCursorPager`, and a cursor
 * token in a shared URL points at a page that may no longer exist.
 */
export function useTableParams<TFilter extends string>({
  filterKeys,
  searchable = false,
  pageSize: defaultPageSize,
  sortLabels,
}: UseTableParamsOptions<TFilter>) {
  const { searchParams, updateParams } = useSearchParam();

  const search = searchable ? (searchParams.get("search") ?? "") : "";
  const sortBy = searchParams.get("sort_by");
  const sortType = searchParams.get("sort_type") === "desc" ? "desc" : "asc";
  const pageSize = Number(searchParams.get("page_size")) || defaultPageSize;

  // Read into a plain record so `query` below depends on a value, not on the
  // searchParams object, whose identity changes on every navigation.
  const filterValues = filterKeys.map((key) => `${key}=${searchParams.get(key) ?? ""}`).join("&");

  const query = useMemo(() => {
    const params: Record<string, string | number> = {};
    for (const pair of filterValues.split("&")) {
      const [key, value] = pair.split("=");
      if (key && value) params[key] = value;
    }
    if (search) params.search = search;
    if (sortBy) params.ordering = sortType === "desc" ? `-${sortBy}` : sortBy;
    params.page_size = pageSize;
    return params;
  }, [filterValues, search, sortBy, sortType, pageSize]);

  return {
    /** Current value of one filter, or the "all" sentinel when it is not applied. */
    filter: (key: TFilter) => searchParams.get(key) ?? ALL_FILTER_VALUE,
    /** Writes a filter; the "all" sentinel removes the key rather than sending it. */
    setFilter: (key: TFilter, value: string) => {
      updateParams({ [key]: value === ALL_FILTER_VALUE ? null : value });
    },
    /**
     * A free-text filter's raw value — a date bound, say — where "" means unset.
     * Separate from `filter`, whose empty state is the "all" sentinel a Select needs;
     * a date input given "__all__" would render it as the date.
     */
    text: (key: TFilter) => searchParams.get(key) ?? "",
    setText: (key: TFilter, value: string) => {
      updateParams({ [key]: value || null });
    },
    search,
    setSearch: (value: string) => {
      updateParams({ search: value || null });
    },
    /** Ready to hand straight to `DataTable`, or undefined when this list cannot sort. */
    sort: sortLabels
      ? ({
          activeKey: sortBy,
          direction: sortType,
          onChange: (key, direction) => {
            updateParams({ sort_by: key, sort_type: direction });
          },
          sortAscendingLabel: sortLabels.ascending,
          sortDescendingLabel: sortLabels.descending,
        } satisfies DataTableSort)
      : undefined,
    pageSize,
    setPageSize: (size: number) => {
      updateParams({ page_size: String(size) });
    },
    /**
     * Clears filters and search, and the sort with them — a reader pressing "Clear
     * filters" on a list they have also reordered means the whole view, not half of it.
     * Page size survives: it is a preference about how they read, not a filter.
     */
    clear: () => {
      updateParams({
        ...Object.fromEntries(filterKeys.map((key) => [key, null])),
        search: null,
        sort_by: null,
        sort_type: null,
      });
    },
    /** Request params: active filters + search + `ordering` + `page_size`. */
    query,
  };
}
