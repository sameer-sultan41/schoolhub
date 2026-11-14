"use client";

import { useTranslations } from "next-intl";
import { Input } from "@schoolhub/ui";

import { FilterSelect } from "@/components/filter-select";
import { SearchInput } from "@/components/search-input";
import { enumLabel } from "@/lib/enum-label";
import { LEDGER_REFERENCE_TYPES } from "@/services/modules/ledger-entries/ledger-entries-constant";
import { filterToPick, pickToFilter } from "@/features/fees/shared/filter-values";
import { LEDGER_REFERENCE_LABEL_KEY } from "@/features/fees/shared/ledger-labels";

/** The URL filter keys this component writes (`LEDGER_ENTRIES_URL_FILTERS`). */
export interface JournalFilterValues {
  account: string;
  from: string;
  to: string;
  reference: string;
}

export interface JournalFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  values: JournalFilterValues;
  onChange: (changes: Partial<JournalFilterValues>) => void;
  accounts: readonly { id: string; name: string }[];
}

/** The journal's memo search and its filters: account, reference type and an entry-date range. */
export function JournalFilters({
  searchInput,
  onSearchInputChange,
  values,
  onChange,
  accounts,
}: JournalFiltersProps) {
  const t = useTranslations("fees");

  return (
    <>
      <SearchInput
        value={searchInput}
        onChange={onSearchInputChange}
        ariaLabel={t("ledger.journal.filters.search")}
        placeholder={t("ledger.journal.list.searchPlaceholder")}
        clearLabel={t("ledger.journal.filters.clearSearch")}
      />
      <FilterSelect
        label={t("ledger.journal.filters.account")}
        allLabel={t("ledger.journal.filters.all")}
        value={values.account}
        onChange={(pick) => {
          onChange({ account: pick });
        }}
        options={accounts}
      />
      <FilterSelect
        label={t("ledger.journal.filters.reference")}
        allLabel={t("ledger.journal.filters.all")}
        value={filterToPick(values.reference)}
        onChange={(pick) => {
          onChange({ reference: pickToFilter(pick) });
        }}
        options={LEDGER_REFERENCE_TYPES.map((type) => ({
          id: type,
          name: enumLabel(t, LEDGER_REFERENCE_LABEL_KEY, type),
        }))}
      />
      <Input
        type="date"
        className="w-full sm:w-40"
        aria-label={t("ledger.journal.filters.from")}
        value={values.from}
        max={values.to || undefined}
        onChange={(event) => {
          onChange({ from: event.target.value });
        }}
      />
      <Input
        type="date"
        className="w-full sm:w-40"
        aria-label={t("ledger.journal.filters.to")}
        value={values.to}
        min={values.from || undefined}
        onChange={(event) => {
          onChange({ to: event.target.value });
        }}
      />
    </>
  );
}
