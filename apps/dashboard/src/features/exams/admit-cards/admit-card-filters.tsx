"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { FilterSelect } from "@/components/filter-select";
import { FILTER_ALL } from "@/lib/constants";
import { ADMIT_CARD_STATUSES } from "@/services/modules/admit-cards/admit-cards-constant";
import { sectionsOfSittings } from "@/services/modules/admit-cards/admit-cards-helper";
import { useExamSittings } from "@/features/exams/use-exam-sittings";

/** The URL filter keys this component writes (`ADMIT_CARD_URL_FILTERS`). */
export interface AdmitCardFilterValues {
  section: string;
  status: string;
}

export interface AdmitCardFiltersProps {
  examId: string;
  values: AdmitCardFilterValues;
  onChange: (updates: Partial<AdmitCardFilterValues>) => void;
}

/** The tab's section and status filters. The sections are the ones the exam's sittings name (the
 * only ones it issues cards to), read under the Schedule tab's key. */
export function AdmitCardFilters({ examId, values, onChange }: AdmitCardFiltersProps) {
  const t = useTranslations("exams");
  const sittingsQuery = useExamSittings(examId);
  const sittings = sittingsQuery.data;

  const sectionOptions = useMemo(
    () =>
      sectionsOfSittings(sittings ?? []).map((section) => ({
        id: section.id,
        name: t("schedule.classSection", {
          class: section.className,
          section: section.sectionName,
        }),
      })),
    [sittings, t],
  );
  const statusOptions = ADMIT_CARD_STATUSES.map((status) => ({
    id: status,
    name: t(`admitCards.status.${status}`),
  }));

  return (
    <>
      <FilterSelect
        label={t("admitCards.filters.section")}
        allLabel={t("admitCards.filters.all")}
        value={values.section}
        options={sectionOptions}
        onChange={(section) => {
          onChange({ section });
        }}
      />
      <FilterSelect
        label={t("admitCards.filters.status")}
        allLabel={t("admitCards.filters.all")}
        value={values.status === FILTER_ALL ? "" : values.status}
        options={statusOptions}
        onChange={(status) => {
          onChange({ status: status || FILTER_ALL });
        }}
      />
    </>
  );
}
