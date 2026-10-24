"use client";

import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@schoolhub/ui";

import { FilterSelect } from "@/components/filter-select";
import { SearchInput } from "@/components/search-input";
import { useCampuses } from "@/hooks/use-reference-data";
import { PERIOD_KIND } from "@/services/modules/periods/periods-constant";

export interface PeriodFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  campusId: string;
  onCampusIdChange: (campusId: string) => void;
  kind: string;
  onKindChange: (kind: string) => void;
}

/** The bell schedule's search box, campus and kind filters. A campus shows the periods that
 * run there: its own and the tenant-wide ones. */
export function PeriodFilters({
  searchInput,
  onSearchInputChange,
  campusId,
  onCampusIdChange,
  kind,
  onKindChange,
}: PeriodFiltersProps) {
  const t = useTranslations("timetable");
  const campusesQuery = useCampuses();

  return (
    <>
      <SearchInput
        value={searchInput}
        onChange={onSearchInputChange}
        ariaLabel={t("filters.search")}
        placeholder={t("periods.list.searchPlaceholder")}
        clearLabel={t("filters.clearSearch")}
      />
      <FilterSelect
        label={t("fields.campus")}
        allLabel={t("filters.all")}
        value={campusId}
        onChange={onCampusIdChange}
        options={campusesQuery.data ?? []}
      />
      <Select value={kind} onValueChange={onKindChange}>
        <SelectTrigger className="w-full sm:w-40" aria-label={t("periods.filters.kind")}>
          <SelectValue placeholder={t("periods.filters.kind")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PERIOD_KIND.all}>{t("filters.all")}</SelectItem>
          <SelectItem value={PERIOD_KIND.teaching}>{t("periods.teaching")}</SelectItem>
          <SelectItem value={PERIOD_KIND.break}>{t("periods.break")}</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}
