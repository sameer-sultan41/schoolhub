"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { EmptyState } from "@schoolhub/ui";
import { Tag } from "lucide-react";

import { CursorDataGridCard } from "@/components/cursor-data-grid-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useCursorList } from "@/hooks/use-cursor-list";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { FILTER_ALL } from "@/lib/constants";
import { toOrdering } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type FeeHeadRecord } from "@/services";
import {
  FEE_HEADS_DEFAULT_SORTING,
  FEE_HEADS_LIST_RESOURCE,
  FEE_HEADS_PAGE_SIZE,
  FEE_HEADS_QUERY_MODULE,
  FEE_HEADS_SORT_FIELD,
  FEE_HEADS_SORTABLE_IDS,
  FEE_HEADS_URL_FILTERS,
} from "@/services/modules/fee-heads/fee-heads-constant";
import {
  feeHeadActiveFilterToFlag,
  feeHeadCategoryFilter,
} from "@/services/modules/fee-heads/fee-heads-helper";
import { FeesTabHeader } from "@/features/fees/shared/fees-tab-header";
import { useLedgerAccountOptions } from "@/features/fees/shared/use-fee-options";
import { DeleteFeeHeadDialog } from "./delete-fee-head-dialog";
import { useFeeHeadColumns } from "./fee-head-columns";
import { FeeHeadFilters } from "./fee-head-filters";
import { FeeHeadFormDialog } from "./fee-head-form-dialog";

type FormTarget = { record?: FeeHeadRecord };

/**
 * The Fee heads tab of `/fees/structures`: cursor-paged, filtered in the URL by category and
 * status. New, Edit and Delete follow `fees.fee-structure.create|update|delete`; New and Edit
 * also need `fees.ledger.view`, as the income account they require is picked from the ledger
 * (L59). The income account column shows names only to a holder of that key too (L55). Each dialog is mounted only while open.
 */
export function FeeHeadsTab() {
  const t = useTranslations("fees");

  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FeeHeadRecord | null>(null);

  const { data: user } = useCurrentUser();
  const canReadLedger = hasPermission(user, "fees.ledger.view");
  // The form's income account is required and picked from the ledger, so a writer who cannot
  // read it could open the form but never save it: both write gates need `fees.ledger.view` too.
  const canCreate = hasPermission(user, "fees.fee-structure.create") && canReadLedger;
  const canUpdate = hasPermission(user, "fees.fee-structure.update") && canReadLedger;
  const canDelete = hasPermission(user, "fees.fee-structure.delete");

  const accountsQuery = useLedgerAccountOptions({ enabled: canReadLedger });
  const accountNames = useMemo(
    () =>
      new Map(
        (accountsQuery.data ?? []).map((account) => [
          account.id,
          `${account.code} ${account.name}`,
        ]),
      ),
    [accountsQuery.data],
  );

  // Stable, so the columns' own `useMemo` skips a rebuild on a keystroke or a page change.
  const handleEdit = useCallback((record: FeeHeadRecord) => {
    setFormTarget({ record });
  }, []);
  const handleRemove = useCallback((record: FeeHeadRecord) => {
    setDeleteTarget(record);
  }, []);

  const columns = useFeeHeadColumns({
    canUpdate,
    canDelete,
    accountNames,
    onEdit: handleEdit,
    onRemove: handleRemove,
  });
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
    filters: FEE_HEADS_URL_FILTERS,
    sortableIds: FEE_HEADS_SORTABLE_IDS,
    defaultSorting: FEE_HEADS_DEFAULT_SORTING,
    hideableIds,
    trimSearch: true,
  });
  const hasActiveFilter =
    search !== "" || filters.headCategory !== FILTER_ALL || filters.headActive !== FILTER_ALL;
  const ordering = toOrdering(sorting, FEE_HEADS_SORT_FIELD);

  const list = useCursorList({
    // A cursor is good only for the query that issued it: any filter or sort change starts over.
    resetKey: [search, ordering, filters.headCategory, filters.headActive].join("|"),
    queryKey: (cursor) =>
      queryKeys.list(FEE_HEADS_QUERY_MODULE, FEE_HEADS_LIST_RESOURCE, {
        cursor,
        search,
        ordering,
        ...filters,
      }),
    queryFn: (cursor) =>
      Services.feeHeads.listFeeHeads({
        cursor,
        pageSize: FEE_HEADS_PAGE_SIZE,
        ordering,
        search: search || undefined,
        category: feeHeadCategoryFilter(filters.headCategory),
        isActive: feeHeadActiveFilterToFlag(filters.headActive),
      }),
  });

  const table = useReactTable({
    data: list.rows,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange,
    onColumnVisibilityChange,
    manualPagination: true,
    manualSorting: true,
    getRowId: (record) => record.id,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <>
      <FeesTabHeader
        createLabel={t("heads.actions.create")}
        onCreate={
          canCreate
            ? () => {
                setFormTarget({});
              }
            : undefined
        }
      />
      <CursorDataGridCard
        list={list}
        table={table}
        caption={t("heads.list.caption")}
        paginationLabel={t("heads.list.pagination")}
        loadErrorMessage={t("heads.list.loadError")}
        filters={
          <FeeHeadFilters
            searchInput={searchInput}
            onSearchInputChange={setSearchInput}
            values={filters}
            onChange={setFilters}
          />
        }
        emptyState={
          <EmptyState
            icon={Tag}
            title={t(hasActiveFilter ? "heads.list.noMatches" : "heads.list.emptyTitle")}
            description={t(
              hasActiveFilter ? "heads.list.noMatchesDescription" : "heads.list.emptyDescription",
            )}
          />
        }
      />
      {formTarget && (
        <FeeHeadFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setFormTarget(null);
          }}
          record={formTarget.record}
        />
      )}
      {deleteTarget && (
        <DeleteFeeHeadDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          record={deleteTarget}
        />
      )}
    </>
  );
}
