"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Input } from "@schoolhub/ui";

import { FilterSelect } from "@/components/filter-select";
import { useClasses, useSections } from "@/hooks/use-reference-data";
import type { UrlParamUpdates } from "@/hooks/use-url-params";
import { isIsoDate } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  PERIODS_FOR_CAMPUS_RESOURCE,
  PERIODS_QUERY_MODULE,
} from "@/services/modules/periods/periods-constant";
import { lessonPeriodsOn, toShortTime } from "@/services/modules/periods/periods-helper";
import { REGISTER_URL_KEYS } from "@/services/modules/student-attendance/student-attendance-constant";

export interface RegisterPickersProps {
  date: string;
  classId: string;
  sectionId: string;
  periodId: string;
  /** Period mode: a register is per period, so a period is picked too. */
  periodMode: boolean;
  /** The open register's campus when its class isn't picked (opened from My registers). */
  campusIdHint: string;
  onChange: (updates: UrlParamUpdates) => void;
}

/**
 * Which register to open: the date, then a class, its section and, in period mode, a lesson
 * period of that section's campus. Shown to every marker beside My registers: the client knows
 * keys, not scopes, so the server decides (a register the viewer may not mark is a 404).
 */
export function RegisterPickers({
  date,
  classId,
  sectionId,
  periodId,
  periodMode,
  campusIdHint,
  onChange,
}: RegisterPickersProps) {
  const t = useTranslations("attendance");
  const classesQuery = useClasses({ isActive: true });
  const sectionsQuery = useSections(classId, { isActive: true });
  const pickedSection = sectionsQuery.data?.find((section) => section.id === sectionId);
  const campusId = pickedSection?.campus_id ?? campusIdHint;

  const periodsQuery = useQuery({
    queryKey: queryKeys.list(PERIODS_QUERY_MODULE, PERIODS_FOR_CAMPUS_RESOURCE, { campusId }),
    queryFn: () => Services.periods.fetchCampusPeriods(campusId),
    enabled: periodMode && campusId !== "",
  });
  const periodOptions = useMemo(
    () =>
      lessonPeriodsOn(periodsQuery.data ?? [], date).map((period) => ({
        id: period.id,
        name: t("register.periodOption", {
          name: period.name,
          start: toShortTime(period.start_time),
          end: toShortTime(period.end_time),
        }),
      })),
    [periodsQuery.data, date, t],
  );
  // A select holds only a value it lists: a register opened from My registers has no class
  // picked, so its section (and a period not yet loaded) shows as unpicked, not as a blank.
  const shownPeriodId = periodOptions.some((option) => option.id === periodId) ? periodId : "";

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Input
        type="date"
        value={date}
        aria-label={t("register.fields.date")}
        className="w-full sm:w-44"
        onChange={(event) => {
          const value = event.target.value;
          // A cleared date goes back to today, the URL's default. In period mode the period
          // goes too: the new day may have no lesson in it. The section stays.
          onChange({
            [REGISTER_URL_KEYS.date]: isIsoDate(value) ? value : null,
            ...(periodMode && { [REGISTER_URL_KEYS.period]: null }),
          });
        }}
      />
      <FilterSelect
        label={t("register.fields.class")}
        value={classId}
        options={classesQuery.data ?? []}
        onChange={(value) => {
          onChange({
            [REGISTER_URL_KEYS.class]: value || null,
            [REGISTER_URL_KEYS.section]: null,
            [REGISTER_URL_KEYS.period]: null,
          });
        }}
      />
      <FilterSelect
        label={t("register.fields.section")}
        value={pickedSection ? sectionId : ""}
        options={sectionsQuery.data ?? []}
        disabled={classId === ""}
        onChange={(value) => {
          onChange({
            [REGISTER_URL_KEYS.section]: value || null,
            [REGISTER_URL_KEYS.period]: null,
          });
        }}
      />
      {periodMode && (
        <FilterSelect
          label={t("register.fields.period")}
          value={shownPeriodId}
          options={periodOptions}
          disabled={campusId === ""}
          onChange={(value) => {
            onChange({ [REGISTER_URL_KEYS.period]: value || null });
          }}
        />
      )}
    </div>
  );
}
