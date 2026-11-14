"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@schoolhub/ui";
import { Tags } from "lucide-react";

import { FilterSelect } from "@/components/filter-select";
import { SearchInput } from "@/components/search-input";
import { CursorDataGridCard } from "@/components/cursor-data-grid-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { Services, type ExpenseCategoryRecord } from "@/services";
import {
  EXPENSE_CATEGORIES_DEFAULT_SORTING,
  EXPENSE_CATEGORIES_LIST_RESOURCE,
  EXPENSE_CATEGORIES_PAGE_SIZE,
  EXPENSE_CATEGORIES_QUERY_MODULE,
  EXPENSE_CATEGORIES_SORT_FIELD,
  EXPENSE_CATEGORIES_URL_FILTERS,
  EXPENSE_CATEGORY_ACTIVE_FILTERS,
} from "@/services/modules/expense-categories/expense-categories-constant";
import { categoryActiveFilterToFlag } from "@/services/modules/expense-categories/expense-categories-helper";
import { filterToPick, pickToFilter } from "@/features/fees/shared/filter-values";
import { FeesTabHeader } from "@/features/fees/shared/fees-tab-header";
import { NameLookupProvider, type NameLookups } from "@/features/fees/shared/name-lookup";
import { useCollectionList } from "@/features/fees/shared/use-collection-list";
import { useLedgerAccountOptions } from "@/features/fees/shared/use-fee-options";
import { useCategoryColumns } from "./category-columns";
import { CategoryFormDialog } from "./category-form-dialog";
import { DeleteCategoryDialog } from "./delete-category-dialog";

type FormTarget = { record?: ExpenseCategoryRecord };

/**
 * The Categories tab: the spend taxonomy, cursor-paged and filtered by status. Create and Edit
 * need `fees.expense.create` and `fees.ledger.view`, because the required expense-account
 * picker reads the ledger (L59); Delete needs `fees.expense.create` alone. The account names
 * come from the ledger read and fall back to a dash without it. Each dialog is mounted only
 * while open.
 */
export function CategoriesTab() {
  const t = useTranslations("fees");
  const { data: user } = useCurrentUser();
  const canWriteCategories = hasPermission(user, "fees.expense.create");
  const canReadLedger = hasPermission(user, "fees.ledger.view");
  const canEdit = canWriteCategories && canReadLedger;

  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExpenseCategoryRecord | null>(null);

  const accountsQuery = useLedgerAccountOptions({ accountType: "expense", enabled: canReadLedger });
  const lookups = useMemo<NameLookups>(
    () => ({
      accounts: new Map(
        (accountsQuery.data ?? []).map((account) => [
          account.id,
          `${account.code} ${account.name}`,
        ]),
      ),
    }),
    [accountsQuery.data],
  );

  const onEdit = useCallback((record: ExpenseCategoryRecord) => {
    setFormTarget({ record });
  }, []);
  const onRemove = useCallback((record: ExpenseCategoryRecord) => {
    setDeleteTarget(record);
  }, []);
  const columns = useCategoryColumns({
    canEdit,
    canRemove: canWriteCategories,
    onEdit,
    onRemove,
  });

  const { list, table, state, hasActiveFilter } = useCollectionList({
    columns,
    queryModule: EXPENSE_CATEGORIES_QUERY_MODULE,
    listResource: EXPENSE_CATEGORIES_LIST_RESOURCE,
    urlFilters: EXPENSE_CATEGORIES_URL_FILTERS,
    sortField: EXPENSE_CATEGORIES_SORT_FIELD,
    defaultSorting: EXPENSE_CATEGORIES_DEFAULT_SORTING,
    pageSize: EXPENSE_CATEGORIES_PAGE_SIZE,
    fetchPage: ({ cursor, pageSize, ordering, search, filters }) =>
      Services.expenseCategories.listExpenseCategories({
        cursor,
        pageSize,
        ordering,
        search: search || undefined,
        isActive: categoryActiveFilterToFlag(filters.active),
      }),
  });

  return (
    <NameLookupProvider value={lookups}>
      <FeesTabHeader
        createLabel={t("expenses.categories.actions.create")}
        onCreate={
          canEdit
            ? () => {
                setFormTarget({});
              }
            : undefined
        }
      />
      <CursorDataGridCard
        list={list}
        table={table}
        caption={t("expenses.categories.list.caption")}
        paginationLabel={t("expenses.categories.list.pagination")}
        loadErrorMessage={t("expenses.categories.list.loadError")}
        filters={
          <>
            <SearchInput
              value={state.searchInput}
              onChange={state.setSearchInput}
              ariaLabel={t("expenses.categories.filters.search")}
              placeholder={t("expenses.categories.list.searchPlaceholder")}
              clearLabel={t("expenses.categories.filters.clearSearch")}
            />
            <FilterSelect
              label={t("expenses.categories.filters.active")}
              allLabel={t("expenses.categories.filters.all")}
              value={filterToPick(state.filters.active)}
              onChange={(pick) => {
                state.setFilters({ active: pickToFilter(pick) });
              }}
              options={EXPENSE_CATEGORY_ACTIVE_FILTERS.map((active) => ({
                id: active,
                name: t(`expenses.categories.status.${active}`),
              }))}
            />
          </>
        }
        emptyState={
          <EmptyState
            icon={Tags}
            title={t(
              hasActiveFilter
                ? "expenses.categories.list.noMatches"
                : "expenses.categories.list.emptyTitle",
            )}
            description={t(
              hasActiveFilter
                ? "expenses.categories.list.noMatchesDescription"
                : "expenses.categories.list.emptyDescription",
            )}
          />
        }
      />
      {formTarget && (
        <CategoryFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setFormTarget(null);
          }}
          record={formTarget.record}
        />
      )}
      {deleteTarget && (
        <DeleteCategoryDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          record={deleteTarget}
        />
      )}
    </NameLookupProvider>
  );
}
