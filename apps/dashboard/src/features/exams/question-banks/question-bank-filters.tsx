"use client";

import { useTranslations } from "next-intl";

import { FilterSelect } from "@/components/filter-select";
import { SearchInput } from "@/components/search-input";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useSubjects } from "@/hooks/use-reference-data";
import { FILTER_ALL } from "@/lib/constants";
import { hasPermission } from "@/lib/permissions";
import { BANK_STATUSES } from "@/services/modules/question-banks/question-banks-constant";

/** The URL filter keys this component writes (`BANKS_URL_FILTERS`). */
export interface QuestionBankFilterValues {
  subject: string;
  status: string;
}

export interface QuestionBankFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  values: QuestionBankFilterValues;
  onChange: (changes: Partial<QuestionBankFilterValues>) => void;
}

/** The banks list's search box and its subject and status filters. The subject filter reads
 * `/subjects`, so it shows only to a holder of `school.subject.view` (L55). */
export function QuestionBankFilters({
  searchInput,
  onSearchInputChange,
  values,
  onChange,
}: QuestionBankFiltersProps) {
  const t = useTranslations("exams");
  const { data: user } = useCurrentUser();
  const canReadSubjects = hasPermission(user, "school.subject.view");
  const subjectsQuery = useSubjects({ enabled: canReadSubjects });

  return (
    <>
      <SearchInput
        value={searchInput}
        onChange={onSearchInputChange}
        ariaLabel={t("questionBanks.filters.search")}
        placeholder={t("questionBanks.list.searchPlaceholder")}
        clearLabel={t("questionBanks.filters.clearSearch")}
      />
      {canReadSubjects && (
        <FilterSelect
          label={t("questionBanks.filters.subject")}
          allLabel={t("questionBanks.filters.all")}
          value={values.subject}
          onChange={(subject) => {
            onChange({ subject });
          }}
          options={subjectsQuery.data ?? []}
        />
      )}
      <FilterSelect
        label={t("questionBanks.filters.status")}
        allLabel={t("questionBanks.filters.all")}
        value={values.status === FILTER_ALL ? "" : values.status}
        onChange={(status) => {
          onChange({ status: status || FILTER_ALL });
        }}
        options={BANK_STATUSES.map((status) => ({
          id: status,
          name: t(`questionBanks.status.${status}`),
        }))}
      />
    </>
  );
}
