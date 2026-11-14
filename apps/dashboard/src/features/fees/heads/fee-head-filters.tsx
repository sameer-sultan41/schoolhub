"use client";

import { useTranslations } from "next-intl";

import { FilterSelect } from "@/components/filter-select";
import { SearchInput } from "@/components/search-input";
import { FILTER_ALL } from "@/lib/constants";
import { enumLabel } from "@/lib/enum-label";
import {
  FEE_HEAD_ACTIVE_FILTERS,
  FEE_HEAD_CATEGORIES,
} from "@/services/modules/fee-heads/fee-heads-constant";
import { FEE_HEAD_CATEGORY_LABEL_KEY } from "@/features/fees/shared/fee-setup-labels";

/** The URL filter keys this component writes (`FEE_HEADS_URL_FILTERS`). */
export interface FeeHeadFilterValues {
  headCategory: string;
  headActive: string;
}

export interface FeeHeadFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  values: FeeHeadFilterValues;
  onChange: (changes: Partial<FeeHeadFilterValues>) => void;
}

const toPick = (filter: string) => (filter === FILTER_ALL ? "" : filter);
const toFilter = (pick: string) => (pick === "" ? FILTER_ALL : pick);

/** The fee heads list's search box and its category and status filters. */
export function FeeHeadFilters({
  searchInput,
  onSearchInputChange,
  values,
  onChange,
}: FeeHeadFiltersProps) {
  const t = useTranslations("fees");

  return (
    <>
      <SearchInput
        value={searchInput}
        onChange={onSearchInputChange}
        ariaLabel={t("heads.filters.search")}
        placeholder={t("heads.list.searchPlaceholder")}
        clearLabel={t("heads.filters.clearSearch")}
      />
      <FilterSelect
        label={t("heads.filters.category")}
        allLabel={t("heads.filters.all")}
        value={toPick(values.headCategory)}
        onChange={(pick) => {
          onChange({ headCategory: toFilter(pick) });
        }}
        options={FEE_HEAD_CATEGORIES.map((category) => ({
          id: category,
          name: enumLabel(t, FEE_HEAD_CATEGORY_LABEL_KEY, category),
        }))}
      />
      <FilterSelect
        label={t("heads.filters.status")}
        allLabel={t("heads.filters.all")}
        value={toPick(values.headActive)}
        onChange={(pick) => {
          onChange({ headActive: toFilter(pick) });
        }}
        options={FEE_HEAD_ACTIVE_FILTERS.map((active) => ({
          id: active,
          name: t(`heads.status.${active}`),
        }))}
      />
    </>
  );
}
