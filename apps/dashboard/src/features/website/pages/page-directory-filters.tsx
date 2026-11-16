"use client";

import { useTranslations } from "next-intl";

import { FilterSelect } from "@/components/filter-select";
import { SearchInput } from "@/components/search-input";
import { FILTER_ALL } from "@/lib/constants";
import { enumLabel } from "@/lib/enum-label";
import { WEBSITE_PAGE_TYPES } from "@/services/modules/website/website-pages/website-pages-constant";
import { WEBSITE_CONTENT_STATUSES } from "@/services/shared/website-content";
import { CONTENT_STATUS_LABEL_KEY } from "@/features/website/shared/content-status-badge";
import { usePageTypeLabel } from "./page-type-label";

/** The URL filter keys this component writes (`PAGES_URL_FILTERS`). */
export interface PageFilterValues {
  status: string;
  type: string;
}

export interface PageDirectoryFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  values: PageFilterValues;
  onChange: (changes: Partial<PageFilterValues>) => void;
}

/** The pages list's search box (title or address) and its status and type filters. */
export function PageDirectoryFilters({
  searchInput,
  onSearchInputChange,
  values,
  onChange,
}: PageDirectoryFiltersProps) {
  const t = useTranslations("website");
  const typeLabel = usePageTypeLabel();

  return (
    <>
      <SearchInput
        value={searchInput}
        onChange={onSearchInputChange}
        ariaLabel={t("pages.filters.search")}
        placeholder={t("pages.list.searchPlaceholder")}
        clearLabel={t("pages.filters.clearSearch")}
      />
      <FilterSelect
        label={t("pages.filters.status")}
        allLabel={t("pages.filters.all")}
        value={values.status === FILTER_ALL ? "" : values.status}
        onChange={(status) => {
          onChange({ status: status || FILTER_ALL });
        }}
        options={WEBSITE_CONTENT_STATUSES.map((status) => ({
          id: status,
          name: enumLabel(t, CONTENT_STATUS_LABEL_KEY, status),
        }))}
      />
      <FilterSelect
        label={t("pages.filters.type")}
        allLabel={t("pages.filters.all")}
        value={values.type === FILTER_ALL ? "" : values.type}
        onChange={(type) => {
          onChange({ type: type || FILTER_ALL });
        }}
        options={WEBSITE_PAGE_TYPES.map((type) => ({ id: type, name: typeLabel(type) }))}
      />
    </>
  );
}
