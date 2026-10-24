"use client";

import { useTranslations } from "next-intl";
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";

import { SearchInput } from "@/components/search-input";
import { FILTER_ALL } from "@/lib/constants";
import { SUBSTITUTION_STATUSES } from "@/services/modules/teacher-substitutions/teacher-substitutions-constant";

export interface SubstitutionFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  status: string;
  onStatusChange: (status: string) => void;
  from: string;
  onFromChange: (date: string) => void;
  to: string;
  onToChange: (date: string) => void;
}

/** The cover queue's search box, status filter and date range (inclusive). */
export function SubstitutionFilters(props: SubstitutionFiltersProps) {
  const t = useTranslations("timetable");

  return (
    <>
      <SearchInput
        value={props.searchInput}
        onChange={props.onSearchInputChange}
        ariaLabel={t("filters.search")}
        placeholder={t("substitutions.list.searchPlaceholder")}
        clearLabel={t("filters.clearSearch")}
      />
      <Select value={props.status} onValueChange={props.onStatusChange}>
        <SelectTrigger className="w-full sm:w-40" aria-label={t("substitutions.filters.status")}>
          <SelectValue placeholder={t("substitutions.filters.status")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={FILTER_ALL}>{t("filters.all")}</SelectItem>
          {SUBSTITUTION_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>
              {t(`substitutions.status.${status}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="date"
        className="w-full sm:w-40"
        aria-label={t("substitutions.filters.from")}
        value={props.from}
        max={props.to || undefined}
        onChange={(event) => {
          props.onFromChange(event.target.value);
        }}
      />
      <Input
        type="date"
        className="w-full sm:w-40"
        aria-label={t("substitutions.filters.to")}
        value={props.to}
        min={props.from || undefined}
        onChange={(event) => {
          props.onToChange(event.target.value);
        }}
      />
    </>
  );
}
