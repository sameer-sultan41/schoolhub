"use client";

import { useTranslations } from "next-intl";

import { FilterSelect } from "@/components/filter-select";
import { SearchInput } from "@/components/search-input";
import { FILTER_ALL } from "@/lib/constants";
import { enumLabel } from "@/lib/enum-label";
import { FEE_STRUCTURE_STATUSES } from "@/services/modules/fee-structures/fee-structures-constant";
import { STRUCTURE_STATUS_LABEL_KEY } from "@/features/fees/shared/fee-setup-labels";
import { useStructureReferences } from "@/features/fees/shared/use-structure-references";

/** The URL filter keys this component writes (`FEE_STRUCTURES_URL_FILTERS`). */
export interface StructureFilterValues {
  session: string;
  class: string;
  campus: string;
  status: string;
}

export interface StructureFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  values: StructureFilterValues;
  onChange: (changes: Partial<StructureFilterValues>) => void;
}

const toPick = (filter: string) => (filter === FILTER_ALL ? "" : filter);
const toFilter = (pick: string) => (pick === "" ? FILTER_ALL : pick);

/** The structures list's search box and its session, class, campus and status filters. Each
 * scope filter reads its own list, so it shows only to a holder of that list's view key (L55). */
export function StructureFilters({
  searchInput,
  onSearchInputChange,
  values,
  onChange,
}: StructureFiltersProps) {
  const t = useTranslations("fees");
  const references = useStructureReferences();

  return (
    <>
      <SearchInput
        value={searchInput}
        onChange={onSearchInputChange}
        ariaLabel={t("structures.filters.search")}
        placeholder={t("structures.list.searchPlaceholder")}
        clearLabel={t("structures.filters.clearSearch")}
      />
      {references.canReadSessions && (
        <FilterSelect
          label={t("structures.filters.session")}
          allLabel={t("structures.filters.all")}
          value={values.session}
          onChange={(session) => {
            onChange({ session });
          }}
          options={references.sessions}
        />
      )}
      {references.canReadClasses && (
        <FilterSelect
          label={t("structures.filters.class")}
          allLabel={t("structures.filters.all")}
          value={values.class}
          onChange={(classId) => {
            onChange({ class: classId });
          }}
          options={references.classes}
        />
      )}
      {references.canReadCampuses && (
        <FilterSelect
          label={t("structures.filters.campus")}
          allLabel={t("structures.filters.all")}
          value={values.campus}
          onChange={(campus) => {
            onChange({ campus });
          }}
          options={references.campuses}
        />
      )}
      <FilterSelect
        label={t("structures.filters.status")}
        allLabel={t("structures.filters.all")}
        value={toPick(values.status)}
        onChange={(pick) => {
          onChange({ status: toFilter(pick) });
        }}
        options={FEE_STRUCTURE_STATUSES.map((status) => ({
          id: status,
          name: enumLabel(t, STRUCTURE_STATUS_LABEL_KEY, status),
        }))}
      />
    </>
  );
}
