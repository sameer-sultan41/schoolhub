"use client";

import type { ReactNode } from "react";
import type { Table } from "@tanstack/react-table";
import { EmptyState } from "@schoolhub/ui";
import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { CursorDataGridCard } from "@/components/cursor-data-grid-card";
import type { CursorList } from "@/hooks/use-cursor-list";

export interface PaymentsListCardProps<TRecord extends { id: string }> {
  list: CursorList<TRecord>;
  table: Table<TRecord>;
  /** The tab's copy namespace under `fees.payments` (`payments`, `receipts`, ...). */
  scope: "payments" | "receipts" | "vouchers" | "refunds" | "imports";
  icon: LucideIcon;
  hasActiveFilter: boolean;
  /** The tab's filter controls. */
  filters: ReactNode;
  onRowClick?: (row: TRecord) => void;
}

/** A payments tab's card: its filters above the grid, and its empty state (a filter that matches nothing reads differently from no rows at all). */
export function PaymentsListCard<TRecord extends { id: string }>({
  list,
  table,
  scope,
  icon,
  hasActiveFilter,
  filters,
  onRowClick,
}: PaymentsListCardProps<TRecord>) {
  const t = useTranslations("fees.payments");

  return (
    <CursorDataGridCard
      list={list}
      table={table}
      caption={t(`${scope}.list.caption`)}
      paginationLabel={t(`${scope}.list.pagination`)}
      loadErrorMessage={t(`${scope}.list.loadError`)}
      filters={filters}
      onRowClick={onRowClick}
      emptyState={
        <EmptyState
          icon={icon}
          title={t(hasActiveFilter ? "filters.noMatches" : `${scope}.list.emptyTitle`)}
          description={t(
            hasActiveFilter ? "filters.noMatchesDescription" : `${scope}.list.emptyDescription`,
          )}
        />
      }
    />
  );
}
