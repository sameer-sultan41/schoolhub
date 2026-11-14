"use client";

import { useTranslations } from "next-intl";
import type { Table } from "@tanstack/react-table";
import { EmptyState } from "@schoolhub/ui";
import type { LucideIcon } from "lucide-react";

import { CursorDataGridCard } from "@/components/cursor-data-grid-card";
import { FilterSelect } from "@/components/filter-select";
import { SearchInput } from "@/components/search-input";
import type { CursorList } from "@/hooks/use-cursor-list";
import { FILTER_ALL } from "@/lib/constants";

export interface GrantsListCardProps<TRecord extends { id: string }> {
  list: CursorList<TRecord>;
  table: Table<TRecord>;
  /** The tab's copy namespace under `fees.grants` (`discounts`, `scholarships`, `fines`). */
  scope: "discounts" | "scholarships" | "fines";
  icon: LucideIcon;
  hasActiveFilter: boolean;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  status: string;
  onStatusChange: (status: string) => void;
  statusOptions: readonly { id: string; name: string }[];
  /** The student URL filter is set by a link; when set, the list offers to clear it. */
  student: string;
  onClearStudent: () => void;
}

const toPick = (filter: string) => (filter === FILTER_ALL ? "" : filter);
const toFilter = (pick: string) => (pick === "" ? FILTER_ALL : pick);

/** A grants tab's card: search, status filter and the student link's clear button above the table, and its empty state. */
export function GrantsListCard<TRecord extends { id: string }>({
  list,
  table,
  scope,
  icon,
  hasActiveFilter,
  searchInput,
  onSearchInputChange,
  status,
  onStatusChange,
  statusOptions,
  student,
  onClearStudent,
}: GrantsListCardProps<TRecord>) {
  const t = useTranslations("fees.grants");

  return (
    <CursorDataGridCard
      list={list}
      table={table}
      caption={t(`${scope}.list.caption`)}
      paginationLabel={t(`${scope}.list.pagination`)}
      loadErrorMessage={t(`${scope}.list.loadError`)}
      filters={
        <>
          <SearchInput
            value={searchInput}
            onChange={onSearchInputChange}
            ariaLabel={t(`${scope}.list.search`)}
            placeholder={t(`${scope}.list.searchPlaceholder`)}
            clearLabel={t("filters.clearSearch")}
          />
          <FilterSelect
            label={t("filters.status")}
            allLabel={t("filters.all")}
            value={toPick(status)}
            onChange={(pick) => {
              onStatusChange(toFilter(pick));
            }}
            options={statusOptions}
          />
          {student !== "" && (
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={onClearStudent}
            >
              {t("filters.clearStudent")}
            </button>
          )}
        </>
      }
      emptyState={
        <EmptyState
          icon={icon}
          title={t(hasActiveFilter ? `${scope}.list.noMatches` : `${scope}.list.emptyTitle`)}
          description={t(
            hasActiveFilter
              ? `${scope}.list.noMatchesDescription`
              : `${scope}.list.emptyDescription`,
          )}
        />
      }
    />
  );
}
