"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Receipt } from "lucide-react";

import { CursorDataGridCard } from "@/components/cursor-data-grid-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useCampuses } from "@/hooks/use-reference-data";
import { hasPermission } from "@/lib/permissions";
import { Services, type ExpenseRecord } from "@/services";
import {
  EXPENSES_DEFAULT_SORTING,
  EXPENSES_LIST_RESOURCE,
  EXPENSES_PAGE_SIZE,
  EXPENSES_QUERY_MODULE,
  EXPENSES_SORT_FIELD,
  EXPENSES_URL_FILTERS,
} from "@/services/modules/expenses/expenses-constant";
import {
  awaitingApprovalFlag,
  expenseStatusFilter,
} from "@/services/modules/expenses/expenses-helper";
import { EmptyState } from "@schoolhub/ui";
import { FeesTabHeader } from "@/features/fees/shared/fees-tab-header";
import { useCollectionList } from "@/features/fees/shared/use-collection-list";
import { useExpenseCategoryOptions } from "@/features/fees/shared/use-fee-options";
import { useExpenseColumns, type ExpenseRowAction } from "./expense-columns";
import { ExpenseActionDialog } from "./expense-action-dialog";
import { ExpenseFilters } from "./expense-filters";
import { ExpenseFormDialog } from "./expense-form-dialog";
import { ReverseExpenseDialog } from "./reverse-expense-dialog";

type Target = { expense?: ExpenseRecord; action: ExpenseRowAction | "create" };

/**
 * The Expenses tab: every expense, filtered by status, category, campus and an expense-date
 * range, plus the approver's "Awaiting approval" queue. New expense follows `fees.expense.create`;
 * each row's actions follow the key and status (see `useExpenseColumns`). Each dialog is mounted
 * only while open.
 */
export function ExpensesTab() {
  const t = useTranslations("fees");
  const { data: user } = useCurrentUser();
  const canCreate = hasPermission(user, "fees.expense.create");
  const canUpdate = hasPermission(user, "fees.expense.update");
  const canApprove = hasPermission(user, "fees.expense.approve");
  const canReadCampuses = hasPermission(user, "school.campus.view");

  const [target, setTarget] = useState<Target | null>(null);
  const onAction = useCallback((action: ExpenseRowAction, expense: ExpenseRecord) => {
    setTarget({ action, expense });
  }, []);

  const columns = useExpenseColumns({
    canCreate,
    canUpdate,
    canApprove,
    currentUserId: user?.id,
    onAction,
  });
  const categoriesQuery = useExpenseCategoryOptions();
  const campusesQuery = useCampuses({ enabled: canReadCampuses });

  const { list, table, state, hasActiveFilter } = useCollectionList({
    columns,
    queryModule: EXPENSES_QUERY_MODULE,
    listResource: EXPENSES_LIST_RESOURCE,
    urlFilters: EXPENSES_URL_FILTERS,
    sortField: EXPENSES_SORT_FIELD,
    defaultSorting: EXPENSES_DEFAULT_SORTING,
    pageSize: EXPENSES_PAGE_SIZE,
    fetchPage: ({ cursor, pageSize, ordering, search, filters }) =>
      Services.expenses.listExpenses({
        cursor,
        pageSize,
        ordering,
        search: search || undefined,
        status: expenseStatusFilter(filters.status),
        expenseCategoryId: filters.category || undefined,
        campusId: filters.campus || undefined,
        dateFrom: filters.from || undefined,
        dateTo: filters.to || undefined,
        awaitingApproval: awaitingApprovalFlag(filters.awaiting),
      }),
  });

  const close = (open: boolean) => {
    if (!open) setTarget(null);
  };
  const expense = target?.expense;

  return (
    <>
      <FeesTabHeader
        createLabel={t("expenses.expenses.actions.create")}
        onCreate={
          canCreate
            ? () => {
                setTarget({ action: "create" });
              }
            : undefined
        }
      />
      <CursorDataGridCard
        list={list}
        table={table}
        caption={t("expenses.expenses.list.caption")}
        paginationLabel={t("expenses.expenses.list.pagination")}
        loadErrorMessage={t("expenses.expenses.list.loadError")}
        filters={
          <ExpenseFilters
            searchInput={state.searchInput}
            onSearchInputChange={state.setSearchInput}
            values={state.filters}
            onChange={state.setFilters}
            categories={(categoriesQuery.data ?? []).map((c) => ({
              id: c.id,
              name: `${c.code} ${c.name}`,
            }))}
            campuses={canReadCampuses ? (campusesQuery.data ?? []) : undefined}
          />
        }
        emptyState={
          <EmptyState
            icon={Receipt}
            title={t(
              hasActiveFilter
                ? "expenses.expenses.list.noMatches"
                : "expenses.expenses.list.emptyTitle",
            )}
            description={t(
              hasActiveFilter
                ? "expenses.expenses.list.noMatchesDescription"
                : "expenses.expenses.list.emptyDescription",
            )}
          />
        }
      />
      {(target?.action === "create" || (target?.action === "edit" && expense)) && (
        <ExpenseFormDialog open onOpenChange={close} record={expense} />
      )}
      {expense &&
        (target.action === "submit" ||
          target.action === "approve" ||
          target.action === "reject" ||
          target.action === "markPaid") && (
          <ExpenseActionDialog open onOpenChange={close} expense={expense} action={target.action} />
        )}
      {expense && target.action === "reverse" && (
        <ReverseExpenseDialog open onOpenChange={close} expense={expense} />
      )}
    </>
  );
}
