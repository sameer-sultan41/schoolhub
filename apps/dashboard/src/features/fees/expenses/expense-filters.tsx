"use client";

import { useTranslations } from "next-intl";
import { Button, Input } from "@schoolhub/ui";

import { FilterSelect } from "@/components/filter-select";
import { SearchInput } from "@/components/search-input";
import { enumLabel } from "@/lib/enum-label";
import {
  AWAITING_APPROVAL_ON,
  EXPENSE_STATUSES,
} from "@/services/modules/expenses/expenses-constant";
import { EXPENSE_STATUS_LABEL_KEY } from "@/features/fees/shared/expense-labels";
import { filterToPick, pickToFilter } from "@/features/fees/shared/filter-values";

/** The URL filter keys this component writes (`EXPENSES_URL_FILTERS`). */
export interface ExpenseFilterValues {
  category: string;
  campus: string;
  status: string;
  from: string;
  to: string;
  awaiting: string;
}

export interface ExpenseFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  values: ExpenseFilterValues;
  onChange: (changes: Partial<ExpenseFilterValues>) => void;
  categories: readonly { id: string; name: string }[];
  /** Empty when the viewer cannot read campuses: the filter is then left out. */
  campuses: readonly { id: string; name: string }[] | undefined;
}

/**
 * The expenses list's search box and filters. "Awaiting approval" is the approver's queue (only
 * submitted expenses); it is a pressed-state button, on when `awaiting` is in the URL.
 */
export function ExpenseFilters({
  searchInput,
  onSearchInputChange,
  values,
  onChange,
  categories,
  campuses,
}: ExpenseFiltersProps) {
  const t = useTranslations("fees");
  const awaiting = values.awaiting === AWAITING_APPROVAL_ON;

  return (
    <>
      <SearchInput
        value={searchInput}
        onChange={onSearchInputChange}
        ariaLabel={t("expenses.expenses.filters.search")}
        placeholder={t("expenses.expenses.list.searchPlaceholder")}
        clearLabel={t("expenses.expenses.filters.clearSearch")}
      />
      <Button
        variant={awaiting ? "primary" : "secondary"}
        appearance={awaiting ? undefined : "light"}
        aria-pressed={awaiting}
        onClick={() => {
          onChange({ awaiting: awaiting ? "" : AWAITING_APPROVAL_ON });
        }}
      >
        {t("expenses.expenses.filters.awaiting")}
      </Button>
      <FilterSelect
        label={t("expenses.expenses.filters.status")}
        allLabel={t("expenses.expenses.filters.all")}
        value={filterToPick(values.status)}
        onChange={(pick) => {
          onChange({ status: pickToFilter(pick) });
        }}
        options={EXPENSE_STATUSES.map((status) => ({
          id: status,
          name: enumLabel(t, EXPENSE_STATUS_LABEL_KEY, status),
        }))}
      />
      <FilterSelect
        label={t("expenses.expenses.filters.category")}
        allLabel={t("expenses.expenses.filters.all")}
        value={values.category}
        onChange={(pick) => {
          onChange({ category: pick });
        }}
        options={categories}
      />
      {campuses && (
        <FilterSelect
          label={t("expenses.expenses.filters.campus")}
          allLabel={t("expenses.expenses.filters.all")}
          value={values.campus}
          onChange={(pick) => {
            onChange({ campus: pick });
          }}
          options={campuses}
        />
      )}
      <Input
        type="date"
        className="w-full sm:w-40"
        aria-label={t("expenses.expenses.filters.from")}
        value={values.from}
        max={values.to || undefined}
        onChange={(event) => {
          onChange({ from: event.target.value });
        }}
      />
      <Input
        type="date"
        className="w-full sm:w-40"
        aria-label={t("expenses.expenses.filters.to")}
        value={values.to}
        min={values.from || undefined}
        onChange={(event) => {
          onChange({ to: event.target.value });
        }}
      />
    </>
  );
}
