"use client";

import { useTranslations } from "next-intl";

import { FilterSelect } from "@/components/filter-select";
import { DateRangeInputs } from "@/features/attendance/date-range-inputs";
import { FILTER_ALL } from "@/lib/constants";
import { LEAVE_STATUSES } from "@/services/modules/leave-requests/leave-requests-constant";
import { useLeaveTypes } from "./use-leave-types";

/** The URL filter keys this component writes (`LEAVE_URL_FILTERS`). */
export interface LeaveFilterValues {
  status: string;
  type: string;
  from: string;
  to: string;
}

export interface LeaveFiltersProps {
  values: LeaveFilterValues;
  onChange: (updates: Partial<LeaveFilterValues>) => void;
}

/** The queue's status and leave-type filters, and the date range: requests that start on or
 * after `from` and end on or before `to`. */
export function LeaveFilters({ values, onChange }: LeaveFiltersProps) {
  const t = useTranslations("attendance");
  const typesQuery = useLeaveTypes();
  const statusOptions = LEAVE_STATUSES.map((status) => ({
    id: status,
    name: t(`requestStatus.${status}`),
  }));

  return (
    <>
      <FilterSelect
        label={t("leave.filters.status")}
        allLabel={t("leave.filters.all")}
        value={values.status === FILTER_ALL ? "" : values.status}
        options={statusOptions}
        onChange={(status) => {
          onChange({ status: status || FILTER_ALL });
        }}
      />
      <FilterSelect
        label={t("leave.filters.type")}
        allLabel={t("leave.filters.all")}
        value={values.type}
        options={typesQuery.data ?? []}
        onChange={(type) => {
          onChange({ type });
        }}
      />
      <DateRangeInputs
        from={values.from}
        to={values.to}
        fromLabel={t("leave.filters.from")}
        toLabel={t("leave.filters.to")}
        onChange={onChange}
      />
    </>
  );
}
