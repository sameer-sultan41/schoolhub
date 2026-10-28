"use client";

import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@schoolhub/ui";

import { FilterSelect } from "@/components/filter-select";
import { DateRangeInputs } from "@/features/attendance/date-range-inputs";
import { useClasses } from "@/hooks/use-reference-data";
import { FILTER_ALL } from "@/lib/constants";
import {
  ATTENDANCE_STATUSES,
  RECORDS_LOCK_FILTERS,
} from "@/services/modules/student-attendance/student-attendance-constant";

/** The URL filter keys this component writes (`RECORDS_URL_FILTERS`). */
export interface RecordsFilterValues {
  from: string;
  to: string;
  class: string;
  section: string;
  status: string;
  locked: string;
}

export interface RecordsFiltersProps {
  /** `from` and `to` are the dates in effect, the default window included; `section` is the
   * one in effect (empty unless it belongs to the picked class). */
  values: RecordsFilterValues;
  /** The picked class's sections. */
  sections: readonly { id: string; name: string }[];
  onChange: (updates: Partial<RecordsFilterValues>) => void;
}

/** The Records list's date range (inclusive), class then section, status and locked filters. */
export function RecordsFilters({ values, sections, onChange }: RecordsFiltersProps) {
  const t = useTranslations("attendance");
  const classesQuery = useClasses();

  return (
    <>
      <DateRangeInputs
        from={values.from}
        to={values.to}
        fromLabel={t("records.filters.from")}
        toLabel={t("records.filters.to")}
        onChange={onChange}
      />
      <FilterSelect
        label={t("register.fields.class")}
        allLabel={t("records.filters.all")}
        value={values.class}
        options={classesQuery.data ?? []}
        onChange={(value) => {
          onChange({ class: value, section: "" });
        }}
      />
      <FilterSelect
        label={t("register.fields.section")}
        allLabel={t("records.filters.all")}
        value={values.section}
        options={sections}
        disabled={values.class === ""}
        onChange={(value) => {
          onChange({ section: value });
        }}
      />
      <Select
        value={values.status}
        onValueChange={(status) => {
          onChange({ status });
        }}
      >
        <SelectTrigger className="w-full sm:w-40" aria-label={t("records.filters.status")}>
          <SelectValue placeholder={t("records.filters.status")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={FILTER_ALL}>{t("records.filters.all")}</SelectItem>
          {ATTENDANCE_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>
              {t(`status.${status}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={values.locked}
        onValueChange={(locked) => {
          onChange({ locked });
        }}
      >
        <SelectTrigger className="w-full sm:w-40" aria-label={t("records.filters.locked")}>
          <SelectValue placeholder={t("records.filters.locked")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={FILTER_ALL}>{t("records.filters.all")}</SelectItem>
          {RECORDS_LOCK_FILTERS.map((lock) => (
            <SelectItem key={lock} value={lock}>
              {t(`records.lock.${lock}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
