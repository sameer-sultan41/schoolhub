"use client";

import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@schoolhub/ui";

import { DateRangeInputs } from "@/features/attendance/date-range-inputs";
import { FILTER_ALL } from "@/lib/constants";
import { STAFF_ATTENDANCE_STATUSES } from "@/services/modules/staff-attendance/staff-attendance-constant";

/** The URL filter keys this component writes (`STAFF_HISTORY_URL_FILTERS`). */
export interface StaffRecordsFilterValues {
  from: string;
  to: string;
  status: string;
}

export interface StaffRecordsFiltersProps {
  /** `from` and `to` are the dates in effect, the default window included. */
  values: StaffRecordsFilterValues;
  onChange: (updates: Partial<StaffRecordsFilterValues>) => void;
}

/** The staff history's date range (inclusive) and status filter, every staff status listed. */
export function StaffRecordsFilters({ values, onChange }: StaffRecordsFiltersProps) {
  const t = useTranslations("attendance");

  return (
    <>
      <DateRangeInputs
        from={values.from}
        to={values.to}
        fromLabel={t("records.filters.from")}
        toLabel={t("records.filters.to")}
        onChange={onChange}
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
          {STAFF_ATTENDANCE_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>
              {t(`status.${status}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
