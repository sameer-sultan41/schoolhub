"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { EmptyState } from "@schoolhub/ui";
import { BookOpen } from "lucide-react";

import { CursorDataGridCard } from "@/components/cursor-data-grid-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useCursorList } from "@/hooks/use-cursor-list";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { FILTER_ALL } from "@/lib/constants";
import { toOrdering } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type LedgerAccountRecord } from "@/services";
import {
  LEDGER_ACCOUNTS_DEFAULT_SORTING,
  LEDGER_ACCOUNTS_LIST_RESOURCE,
  LEDGER_ACCOUNTS_PAGE_SIZE,
  LEDGER_ACCOUNTS_QUERY_MODULE,
  LEDGER_ACCOUNTS_SORT_FIELD,
  LEDGER_ACCOUNTS_SORTABLE_IDS,
  LEDGER_ACCOUNTS_URL_FILTERS,
} from "@/services/modules/ledger-accounts/ledger-accounts-constant";
import {
  activeFilterToFlag,
  ledgerTypeFilter,
  systemFilterToFlag,
} from "@/services/modules/ledger-accounts/ledger-accounts-helper";
import { FeesTabHeader } from "@/features/fees/shared/fees-tab-header";
import { useLedgerAccountOptions } from "@/features/fees/shared/use-fee-options";
import { AccountFilters } from "./account-filters";
import { AccountFormDialog } from "./account-form-dialog";
import { useAccountColumns } from "./account-columns";
import { DeleteAccountDialog } from "./delete-account-dialog";

type FormTarget = { record?: LedgerAccountRecord };

/**
 * The Ledger → Accounts tab: the chart of accounts, cursor-paged and filtered in the URL by
 * type, status and system. Create, Edit and Delete follow `fees.ledger.create`; Delete is not
 * offered for a system account. Each dialog is mounted only while open.
 */
export function AccountsTab() {
  const t = useTranslations("fees");

  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LedgerAccountRecord | null>(null);

  const { data: user } = useCurrentUser();
  const canWrite = hasPermission(user, "fees.ledger.create");

  // The parent column's names come from the same read the form's picker uses (one cache entry).
  const optionsQuery = useLedgerAccountOptions();
  const accountNames = useMemo(
    () =>
      new Map(
        (optionsQuery.data ?? []).map((account) => [account.id, `${account.code} ${account.name}`]),
      ),
    [optionsQuery.data],
  );

  // Stable, so the columns' own `useMemo` skips a rebuild on a keystroke or a page change.
  const handleEdit = useCallback((record: LedgerAccountRecord) => {
    setFormTarget({ record });
  }, []);
  const handleRemove = useCallback((record: LedgerAccountRecord) => {
    setDeleteTarget(record);
  }, []);

  const columns = useAccountColumns({
    canWrite,
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
    filters: LEDGER_ACCOUNTS_URL_FILTERS,
    sortableIds: LEDGER_ACCOUNTS_SORTABLE_IDS,
    defaultSorting: LEDGER_ACCOUNTS_DEFAULT_SORTING,
    hideableIds,
    trimSearch: true,
  });
  const hasActiveFilter =
    search !== "" ||
    filters.type !== FILTER_ALL ||
    filters.active !== FILTER_ALL ||
    filters.system !== FILTER_ALL;
  const ordering = toOrdering(sorting, LEDGER_ACCOUNTS_SORT_FIELD);

  const list = useCursorList({
    // A cursor is good only for the query that issued it: any filter or sort change starts over.
    resetKey: [search, ordering, filters.type, filters.active, filters.system].join("|"),
    queryKey: (cursor) =>
      queryKeys.list(LEDGER_ACCOUNTS_QUERY_MODULE, LEDGER_ACCOUNTS_LIST_RESOURCE, {
        cursor,
        search,
        ordering,
        ...filters,
      }),
    queryFn: (cursor) =>
      Services.ledgerAccounts.listLedgerAccounts({
        cursor,
        pageSize: LEDGER_ACCOUNTS_PAGE_SIZE,
        ordering,
        search: search || undefined,
        accountType: ledgerTypeFilter(filters.type),
        isActive: activeFilterToFlag(filters.active),
        isSystem: systemFilterToFlag(filters.system),
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
        createLabel={t("ledger.accounts.actions.create")}
        onCreate={
          canWrite
            ? () => {
                setFormTarget({});
              }
            : undefined
        }
      />
      <CursorDataGridCard
        list={list}
        table={table}
        caption={t("ledger.accounts.list.caption")}
        paginationLabel={t("ledger.accounts.list.pagination")}
        loadErrorMessage={t("ledger.accounts.list.loadError")}
        filters={
          <AccountFilters
            searchInput={searchInput}
            onSearchInputChange={setSearchInput}
            values={filters}
            onChange={setFilters}
          />
        }
        emptyState={
          <EmptyState
            icon={BookOpen}
            title={t(
              hasActiveFilter
                ? "ledger.accounts.list.noMatches"
                : "ledger.accounts.list.emptyTitle",
            )}
            description={t(
              hasActiveFilter
                ? "ledger.accounts.list.noMatchesDescription"
                : "ledger.accounts.list.emptyDescription",
            )}
          />
        }
      />
      {formTarget && (
        <AccountFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setFormTarget(null);
          }}
          record={formTarget.record}
        />
      )}
      {deleteTarget && (
        <DeleteAccountDialog
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
