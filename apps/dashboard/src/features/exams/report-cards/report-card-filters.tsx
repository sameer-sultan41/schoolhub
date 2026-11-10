"use client";

import { useTranslations } from "next-intl";

import { FilterSelect } from "@/components/filter-select";
import { FILTER_ALL } from "@/lib/constants";
import { REPORT_CARD_STATUSES } from "@/services/modules/report-cards/report-cards-constant";
import { useExamSectionOptions } from "@/features/exams/use-exam-section-options";

/** The URL filter keys this component writes (`REPORT_CARD_URL_FILTERS`). */
export interface ReportCardFilterValues {
  section: string;
  status: string;
}

export interface ReportCardFiltersProps {
  examId: string;
  values: ReportCardFilterValues;
  onChange: (updates: Partial<ReportCardFilterValues>) => void;
}

/** The Report cards tab's section and status filters; the section one only for a holder of
 * `exams.schedule.view` (`useExamSectionOptions`). */
export function ReportCardFilters({ examId, values, onChange }: ReportCardFiltersProps) {
  const t = useTranslations("exams");
  const sectionOptions = useExamSectionOptions(examId);
  const statusOptions = REPORT_CARD_STATUSES.map((status) => ({
    id: status,
    name: t(`reportCards.status.${status}`),
  }));

  return (
    <>
      {sectionOptions && (
        <FilterSelect
          label={t("reportCards.filters.section")}
          allLabel={t("reportCards.filters.all")}
          value={values.section}
          options={sectionOptions}
          onChange={(section) => {
            onChange({ section });
          }}
        />
      )}
      <FilterSelect
        label={t("reportCards.filters.status")}
        allLabel={t("reportCards.filters.all")}
        value={values.status === FILTER_ALL ? "" : values.status}
        options={statusOptions}
        onChange={(status) => {
          onChange({ status: status || FILTER_ALL });
        }}
      />
    </>
  );
}
