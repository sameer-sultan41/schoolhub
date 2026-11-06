"use client";

import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@schoolhub/ui";

import { SearchInput } from "@/components/search-input";
import { FILTER_ALL } from "@/lib/constants";
import { SCALE_TYPES } from "@/services/modules/grading-scales/grading-scales-constant";

export interface GradingScaleFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  type: string;
  onTypeChange: (type: string) => void;
}

/** The grading scales list's search box and its type filter. */
export function GradingScaleFilters({
  searchInput,
  onSearchInputChange,
  type,
  onTypeChange,
}: GradingScaleFiltersProps) {
  const t = useTranslations("exams");

  return (
    <>
      <SearchInput
        value={searchInput}
        onChange={onSearchInputChange}
        ariaLabel={t("gradingScales.filters.search")}
        placeholder={t("gradingScales.list.searchPlaceholder")}
        clearLabel={t("gradingScales.filters.clearSearch")}
      />
      <Select value={type} onValueChange={onTypeChange}>
        <SelectTrigger className="w-full sm:w-44" aria-label={t("gradingScales.filters.type")}>
          <SelectValue placeholder={t("gradingScales.filters.type")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={FILTER_ALL}>{t("gradingScales.filters.all")}</SelectItem>
          {SCALE_TYPES.map((scaleType) => (
            <SelectItem key={scaleType} value={scaleType}>
              {t(`gradingScales.types.${scaleType}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
