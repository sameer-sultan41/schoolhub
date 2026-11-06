"use client";

import { useTranslations } from "next-intl";

import { FilterSelect } from "@/components/filter-select";
import { FILTER_ALL } from "@/lib/constants";
import {
  RESULT_OUTCOMES,
  RESULT_STATUSES,
} from "@/services/modules/exam-results/exam-results-constant";
import { useExamSectionOptions } from "@/features/exams/use-exam-section-options";

/** The URL filter keys this component writes (`RESULT_URL_FILTERS`). */
export interface ResultFilterValues {
  section: string;
  outcome: string;
  status: string;
}

export interface ResultFiltersProps {
  examId: string;
  values: ResultFilterValues;
  onChange: (updates: Partial<ResultFilterValues>) => void;
}

/** `all` in the URL is "" to `FilterSelect`, and back. */
const fromUrl = (value: string) => (value === FILTER_ALL ? "" : value);
const toUrl = (value: string) => value || FILTER_ALL;

/** The Results tab's section, outcome and status filters; the section one only for a holder of
 * `exams.schedule.view` (`useExamSectionOptions`). */
export function ResultFilters({ examId, values, onChange }: ResultFiltersProps) {
  const t = useTranslations("exams");
  const sectionOptions = useExamSectionOptions(examId);
  const outcomeOptions = RESULT_OUTCOMES.map((outcome) => ({
    id: outcome,
    name: t(`results.outcome.${outcome}`),
  }));
  const statusOptions = RESULT_STATUSES.map((status) => ({
    id: status,
    name: t(`results.status.${status}`),
  }));

  return (
    <>
      {sectionOptions && (
        <FilterSelect
          label={t("results.filters.section")}
          allLabel={t("results.filters.all")}
          value={values.section}
          options={sectionOptions}
          onChange={(section) => {
            onChange({ section });
          }}
        />
      )}
      <FilterSelect
        label={t("results.filters.outcome")}
        allLabel={t("results.filters.all")}
        value={fromUrl(values.outcome)}
        options={outcomeOptions}
        onChange={(outcome) => {
          onChange({ outcome: toUrl(outcome) });
        }}
      />
      <FilterSelect
        label={t("results.filters.status")}
        allLabel={t("results.filters.all")}
        value={fromUrl(values.status)}
        options={statusOptions}
        onChange={(status) => {
          onChange({ status: toUrl(status) });
        }}
      />
    </>
  );
}
