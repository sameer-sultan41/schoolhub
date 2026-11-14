"use client";

import { useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { todayIsoDate } from "@/lib/helpers";
import {
  FINANCE_REPORT_DEFAULT_SORTING,
  FINANCE_REPORT_HIDEABLE_IDS,
  FINANCE_REPORT_KIND_FIELDS,
  FINANCE_REPORT_SORTABLE_IDS,
  FINANCE_REPORT_URL_FILTERS,
} from "@/services/modules/finance-reports/finance-reports-constant";
import {
  effectiveFinanceReportDates,
  isFinanceReportKind,
  toFinanceReportQuery,
} from "@/services/modules/finance-reports/finance-reports-helper";
import type { FinanceReportFormValues } from "@/services";

/**
 * The report form's state, all of it in the URL (`useDataGridUrlState`, which also keeps the
 * table's page): the values in effect (the dates with their defaults) and the report they
 * describe (`query`, `null` while it can't run: a statement with no student, a range that ends
 * before it starts). The report runs as the form changes, so a link opens on its own report and
 * a bare `/fees/reports` opens on today's collection.
 */
export function useReportForm() {
  const { filters, setFilters, pagination, onPaginationChange } = useDataGridUrlState({
    filters: FINANCE_REPORT_URL_FILTERS,
    sortableIds: FINANCE_REPORT_SORTABLE_IDS,
    defaultSorting: FINANCE_REPORT_DEFAULT_SORTING,
    hideableIds: FINANCE_REPORT_HIDEABLE_IDS,
    trimSearch: false,
  });

  const today = todayIsoDate();
  const dates = effectiveFinanceReportDates(filters, today);
  const values: FinanceReportFormValues = { ...filters, from: dates.from, to: dates.to };
  const fields = isFinanceReportKind(filters.kind)
    ? FINANCE_REPORT_KIND_FIELDS[filters.kind]
    : null;

  return {
    values,
    fields,
    query: toFinanceReportQuery(values, today),
    /** Writes the URL; changing any filter returns to the first page of the new report. */
    setFilters,
    pagination,
    onPaginationChange,
  };
}
