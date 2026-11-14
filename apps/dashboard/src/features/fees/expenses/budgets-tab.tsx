"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@schoolhub/ui";
import { PiggyBank } from "lucide-react";

import { CursorDataGridCard } from "@/components/cursor-data-grid-card";
import { FilterSelect } from "@/components/filter-select";
import { useCurrentUser } from "@/hooks/use-current-user";
import { enumLabel } from "@/lib/enum-label";
import { hasPermission } from "@/lib/permissions";
import { Services, type BudgetRecord } from "@/services";
import {
  BUDGET_STATUSES,
  BUDGETS_DEFAULT_SORTING,
  BUDGETS_LIST_RESOURCE,
  BUDGETS_PAGE_SIZE,
  BUDGETS_QUERY_MODULE,
  BUDGETS_SORT_FIELD,
  BUDGETS_URL_FILTERS,
} from "@/services/modules/budgets/budgets-constant";
import { budgetStatusFilter } from "@/services/modules/budgets/budgets-helper";
import { BUDGET_STATUS_LABEL_KEY } from "@/features/fees/shared/expense-labels";
import { FeesTabHeader } from "@/features/fees/shared/fees-tab-header";
import { filterToPick, pickToFilter } from "@/features/fees/shared/filter-values";
import { NameLookupProvider, type NameLookups } from "@/features/fees/shared/name-lookup";
import { useCollectionList } from "@/features/fees/shared/use-collection-list";
import {
  useExpenseCategoryOptions,
  useLedgerAccountOptions,
} from "@/features/fees/shared/use-fee-options";
import { ApproveBudgetDialog } from "./approve-budget-dialog";
import { BudgetFormDialog } from "./budget-form-dialog";
import { useBudgetColumns } from "./budget-columns";

type Target = { kind: "form"; record?: BudgetRecord } | { kind: "approve"; record: BudgetRecord };

/**
 * The Budgets tab: planned figures, filtered by status. New budget and Edit follow
 * `fees.budget.create` (Edit only on a draft); Approve follows `fees.budget.approve`, the owner's
 * key alone, and only on a draft. Target names come from the category and ledger reads. Each
 * dialog is mounted only while open.
 */
export function BudgetsTab() {
  const t = useTranslations("fees");
  const { data: user } = useCurrentUser();
  const canCreate = hasPermission(user, "fees.budget.create");
  const canApprove = hasPermission(user, "fees.budget.approve");
  const canReadLedger = hasPermission(user, "fees.ledger.view");

  const [target, setTarget] = useState<Target | null>(null);

  const categoriesQuery = useExpenseCategoryOptions();
  const accountsQuery = useLedgerAccountOptions({ accountType: "expense", enabled: canReadLedger });
  const lookups = useMemo<NameLookups>(
    () => ({
      categories: new Map((categoriesQuery.data ?? []).map((c) => [c.id, c.name])),
      accounts: new Map((accountsQuery.data ?? []).map((a) => [a.id, `${a.code} ${a.name}`])),
    }),
    [categoriesQuery.data, accountsQuery.data],
  );

  const onEdit = useCallback((record: BudgetRecord) => {
    setTarget({ kind: "form", record });
  }, []);
  const onApprove = useCallback((record: BudgetRecord) => {
    setTarget({ kind: "approve", record });
  }, []);
  const columns = useBudgetColumns({
    canEdit: canCreate,
    canReadLedger,
    canApprove,
    onEdit,
    onApprove,
  });

  const { list, table, state, hasActiveFilter } = useCollectionList({
    columns,
    queryModule: BUDGETS_QUERY_MODULE,
    listResource: BUDGETS_LIST_RESOURCE,
    urlFilters: BUDGETS_URL_FILTERS,
    sortField: BUDGETS_SORT_FIELD,
    defaultSorting: BUDGETS_DEFAULT_SORTING,
    pageSize: BUDGETS_PAGE_SIZE,
    fetchPage: ({ cursor, pageSize, ordering, filters }) =>
      Services.budgets.listBudgets({
        cursor,
        pageSize,
        ordering,
        status: budgetStatusFilter(filters.status),
      }),
  });

  const close = (open: boolean) => {
    if (!open) setTarget(null);
  };

  return (
    <NameLookupProvider value={lookups}>
      <FeesTabHeader
        createLabel={t("expenses.budgets.actions.create")}
        onCreate={
          canCreate
            ? () => {
                setTarget({ kind: "form" });
              }
            : undefined
        }
      />
      <CursorDataGridCard
        list={list}
        table={table}
        caption={t("expenses.budgets.list.caption")}
        paginationLabel={t("expenses.budgets.list.pagination")}
        loadErrorMessage={t("expenses.budgets.list.loadError")}
        filters={
          <FilterSelect
            label={t("expenses.budgets.filters.status")}
            allLabel={t("expenses.budgets.filters.all")}
            value={filterToPick(state.filters.status)}
            onChange={(pick) => {
              state.setFilters({ status: pickToFilter(pick) });
            }}
            options={BUDGET_STATUSES.map((status) => ({
              id: status,
              name: enumLabel(t, BUDGET_STATUS_LABEL_KEY, status),
            }))}
          />
        }
        emptyState={
          <EmptyState
            icon={PiggyBank}
            title={t(
              hasActiveFilter
                ? "expenses.budgets.list.noMatches"
                : "expenses.budgets.list.emptyTitle",
            )}
            description={t(
              hasActiveFilter
                ? "expenses.budgets.list.noMatchesDescription"
                : "expenses.budgets.list.emptyDescription",
            )}
          />
        }
      />
      {target?.kind === "form" && (
        <BudgetFormDialog open onOpenChange={close} record={target.record} />
      )}
      {target?.kind === "approve" && (
        <ApproveBudgetDialog open onOpenChange={close} budget={target.record} />
      )}
    </NameLookupProvider>
  );
}
