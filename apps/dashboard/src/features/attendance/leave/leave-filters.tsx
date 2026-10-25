"use client";

import { useTranslations } from "next-intl";
import { Input } from "@schoolhub/ui";

import { FilterSelect } from "@/components/filter-select";
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
      <Input
        type="date"
        className="w-full sm:w-40"
        aria-label={t("leave.filters.from")}
        value={values.from}
        max={values.to || undefined}
        onChange={(event) => {
          onChange({ from: event.target.value });
        }}
      />
      <Input
        type="date"
        className="w-full sm:w-40"
        aria-label={t("leave.filters.to")}
        value={values.to}
        min={values.from || undefined}
        onChange={(event) => {
          onChange({ to: event.target.value });
        }}
      />
    </>
  );
}
