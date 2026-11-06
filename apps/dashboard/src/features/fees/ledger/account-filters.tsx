"use client";

import { useTranslations } from "next-intl";

import { FilterSelect } from "@/components/filter-select";
import { SearchInput } from "@/components/search-input";
import { FILTER_ALL } from "@/lib/constants";
import { enumLabel } from "@/lib/enum-label";
import {
  LEDGER_ACCOUNT_TYPES,
  LEDGER_ACTIVE_FILTERS,
  LEDGER_SYSTEM_FILTERS,
} from "@/services/modules/ledger-accounts/ledger-accounts-constant";
import { LEDGER_ACCOUNT_TYPE_LABEL_KEY } from "@/features/fees/shared/fee-setup-labels";

/** The URL filter keys this component writes (`LEDGER_ACCOUNTS_URL_FILTERS`). */
export interface AccountFilterValues {
  type: string;
  active: string;
  system: string;
}

export interface AccountFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  values: AccountFilterValues;
  onChange: (changes: Partial<AccountFilterValues>) => void;
}

const toPick = (filter: string) => (filter === FILTER_ALL ? "" : filter);
const toFilter = (pick: string) => (pick === "" ? FILTER_ALL : pick);

/** The accounts list's search box and its type, status and system filters. */
export function AccountFilters({
  searchInput,
  onSearchInputChange,
  values,
  onChange,
}: AccountFiltersProps) {
  const t = useTranslations("fees");

  return (
    <>
      <SearchInput
        value={searchInput}
        onChange={onSearchInputChange}
        ariaLabel={t("ledger.accounts.filters.search")}
        placeholder={t("ledger.accounts.list.searchPlaceholder")}
        clearLabel={t("ledger.accounts.filters.clearSearch")}
      />
      <FilterSelect
        label={t("ledger.accounts.filters.type")}
        allLabel={t("ledger.accounts.filters.all")}
        value={toPick(values.type)}
        onChange={(pick) => {
          onChange({ type: toFilter(pick) });
        }}
        options={LEDGER_ACCOUNT_TYPES.map((type) => ({
          id: type,
          name: enumLabel(t, LEDGER_ACCOUNT_TYPE_LABEL_KEY, type),
        }))}
      />
      <FilterSelect
        label={t("ledger.accounts.filters.active")}
        allLabel={t("ledger.accounts.filters.all")}
        value={toPick(values.active)}
        onChange={(pick) => {
          onChange({ active: toFilter(pick) });
        }}
        options={LEDGER_ACTIVE_FILTERS.map((active) => ({
          id: active,
          name: t(`ledger.accounts.status.${active}`),
        }))}
      />
      <FilterSelect
        label={t("ledger.accounts.filters.system")}
        allLabel={t("ledger.accounts.filters.all")}
        value={toPick(values.system)}
        onChange={(pick) => {
          onChange({ system: toFilter(pick) });
        }}
        options={LEDGER_SYSTEM_FILTERS.map((system) => ({
          id: system,
          name: t(`ledger.accounts.kind.${system}`),
        }))}
      />
    </>
  );
}
