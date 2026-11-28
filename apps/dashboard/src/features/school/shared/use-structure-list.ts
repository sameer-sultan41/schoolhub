"use client";

import type { ColumnDef } from "@tanstack/react-table";
import type { Page } from "@schoolhub/types";

import type { FilterSpec } from "@/hooks/use-data-grid-url-state";
import { usePagedList } from "@/hooks/use-paged-list";
import type { StructurePageQuery } from "@/services";
import {
  SCHOOL_ORGANIZATION_QUERY_MODULE,
  STRUCTURE_ACTIONS_COLUMN_ID,
} from "@/services/modules/school-organization/school-organization-constant";

/** What a list's own filters add to the page query (the status, a campus, a type). */
export type StructureFilterQuery = Omit<
  StructurePageQuery,
  "page" | "pageSize" | "search" | "ordering"
>;

export interface StructureListOptions<TRow extends { id: string }, F extends string> {
  /** The query-key resource the list's pages live under, in the school-organization module. */
  resource: string;
  columns: ColumnDef<TRow>[];
  urlFilters: Record<F, FilterSpec>;
  sortField: Readonly<Record<string, string>>;
  sortableIds: readonly string[];
  defaultSorting: { id: string; desc: boolean }[];
  /** False hides the actions column: the viewer may neither edit nor remove. */
  showActions: boolean;
  /** The URL's filter values as the page query's filters. */
  toFilterQuery: (filters: Record<F, string>) => StructureFilterQuery;
  fetchPage: (query: StructurePageQuery) => Promise<Page<TRow>>;
}

/**
 * One of the School module's paged structure lists: `usePagedList` under the school-organization
 * query module, so a structure write refreshes the pickers that read the same records.
 */
export function useStructureList<TRow extends { id: string }, F extends string>(
  options: StructureListOptions<TRow, F>,
) {
  return usePagedList<TRow, F, StructurePageQuery>({
    ...options,
    queryModule: SCHOOL_ORGANIZATION_QUERY_MODULE,
    actionsColumnId: STRUCTURE_ACTIONS_COLUMN_ID,
  });
}
