"use client";

import { useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { useSections } from "@/hooks/use-reference-data";
import { useUrlParams } from "@/hooks/use-url-params";
import { todayIsoDate } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  REPORT_DEFAULT_SORTING,
  REPORT_HIDEABLE_IDS,
  REPORT_KIND_FIELDS,
  REPORT_SORTABLE_IDS,
  REPORT_URL_FILTERS,
  REPORT_URL_KEYS,
} from "@/services/modules/attendance-reports/attendance-reports-constant";
import { isValidThreshold } from "@/services/modules/attendance-reports/attendance-reports.schema";
import {
  effectiveReportDates,
  isReportKind,
  toReportQuery,
} from "@/services/modules/attendance-reports/attendance-reports-helper";
import {
  PERIODS_FOR_CAMPUS_RESOURCE,
  PERIODS_QUERY_MODULE,
} from "@/services/modules/periods/periods-constant";
import { lessonPeriodsOn, toShortTime } from "@/services/modules/periods/periods-helper";
import type { ReportFormFieldValues } from "./report-form";

/**
 * The report form's state, all of it in the URL (`useDataGridUrlState`, which also keeps the
 * table's page): the values in effect, the section and period options, and the report the form
 * describes (`draft`, `null` while it can't run). A section applies only with its class, and a
 * period only when that section's campus has it as a lesson on the date; until either list
 * loads, the URL's value is trusted. A period is offered only while `periodMode` (the last mode a
 * report reported, or not yet known); once the tenant is known to mark daily, a `period` left in
 * the URL is cleared, so no hidden filter applies.
 */
export function useReportForm({ periodMode }: { periodMode: boolean }) {
  const t = useTranslations("attendance");
  const { searchParams, setParams } = useUrlParams();
  const { filters, setFilters, pagination, onPaginationChange, setPageIndex } = useDataGridUrlState(
    {
      filters: REPORT_URL_FILTERS,
      sortableIds: REPORT_SORTABLE_IDS,
      defaultSorting: REPORT_DEFAULT_SORTING,
      hideableIds: REPORT_HIDEABLE_IDS,
      trimSearch: false,
    },
  );

  const today = todayIsoDate();
  const fields = isReportKind(filters.kind) ? REPORT_KIND_FIELDS[filters.kind] : null;
  const dates = effectiveReportDates(filters, today);

  const offersPeriod = fields?.period === true && periodMode;

  const sectionsQuery = useSections(filters.class);
  const sectionListed =
    sectionsQuery.data === undefined ||
    sectionsQuery.data.some((section) => section.id === filters.section);
  const sectionId = filters.class !== "" && sectionListed ? filters.section : "";
  const campusId = sectionsQuery.data?.find((section) => section.id === sectionId)?.campus_id ?? "";

  const periodsQuery = useQuery({
    queryKey: queryKeys.list(PERIODS_QUERY_MODULE, PERIODS_FOR_CAMPUS_RESOURCE, { campusId }),
    queryFn: () => Services.periods.fetchCampusPeriods(campusId),
    enabled: offersPeriod && campusId !== "",
  });
  const periods = lessonPeriodsOn(periodsQuery.data ?? [], dates.from).map((period) => ({
    id: period.id,
    name: t("register.periodOption", {
      name: period.name,
      start: toShortTime(period.start_time),
      end: toShortTime(period.end_time),
    }),
  }));
  const periodListed =
    periodsQuery.data === undefined || periods.some((period) => period.id === filters.period);
  const periodId = offersPeriod && sectionId !== "" && periodListed ? filters.period : "";

  const hasHiddenPeriod = !periodMode && filters.period !== "";
  useEffect(() => {
    if (hasHiddenPeriod) setParams({ [REPORT_URL_KEYS.period]: null });
  }, [hasHiddenPeriod, setParams]);

  // `setFilters` leaves out a value equal to its default, so the default kind is written here:
  // a link copied after a run then names its report and runs on arrival.
  const kind = filters.kind;
  const writeKind = useCallback(() => {
    setParams({ [REPORT_URL_KEYS.kind]: kind });
  }, [kind, setParams]);

  const values: ReportFormFieldValues = {
    ...filters,
    from: dates.from,
    to: dates.to,
    section: sectionId,
    period: periodId,
  };
  const thresholdInvalid = fields?.threshold === true && !isValidThreshold(filters.threshold);
  const draft = toReportQuery(
    {
      kind: filters.kind,
      from: dates.from,
      to: dates.to,
      sectionId,
      periodId,
      threshold: filters.threshold,
    },
    today,
  );

  return {
    values,
    sections: sectionsQuery.data ?? [],
    periods,
    /** The period picker shows: the daily register with a section, outside daily mode. */
    showPeriod: offersPeriod && sectionId !== "",
    thresholdInvalid,
    draft,
    /** A shared link names its report: it runs on arrival rather than waiting for Run. */
    linksToReport: searchParams.has(REPORT_URL_KEYS.kind),
    setFilters,
    writeKind,
    pagination,
    onPaginationChange,
    setPageIndex,
  };
}
