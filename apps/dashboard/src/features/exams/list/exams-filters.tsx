"use client";

import { useTranslations } from "next-intl";

import { FilterSelect } from "@/components/filter-select";
import { SearchInput } from "@/components/search-input";
import { FILTER_ALL } from "@/lib/constants";
import { useTerms } from "@/hooks/use-reference-data";
import type { AcademicSessionSummary } from "@/services";
import { EXAM_STATUSES, EXAM_TYPES } from "@/services/modules/exams/exams-constant";

export interface ExamsFiltersValues {
  session: string;
  term: string;
  status: string;
  type: string;
}

export interface ExamsFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  values: ExamsFiltersValues;
  onChange: (changes: Partial<ExamsFiltersValues>) => void;
  /** Loaded sessions; the session picker shows only when there is at least one. */
  sessions: AcademicSessionSummary[] | undefined;
}

const toPick = (filter: string) => (filter === FILTER_ALL ? "" : filter);
const toFilter = (pick: string) => (pick === "" ? FILTER_ALL : pick);

/**
 * The exams list's search box and its session, term, status and type filters. Every one is
 * optional and starts unset. The session picker shows only once sessions load with rows (a
 * teacher may be allowed to see exams but not the session list), and the term picker only for a
 * picked session: a term belongs to one session, so changing the session clears the term.
 */
export function ExamsFilters({
  searchInput,
  onSearchInputChange,
  values,
  onChange,
  sessions,
}: ExamsFiltersProps) {
  const t = useTranslations("exams");
  const hasSessions = sessions !== undefined && sessions.length > 0;
  const sessionId = hasSessions ? toPick(values.session) : "";
  const termsQuery = useTerms(sessionId);
  const terms = termsQuery.data ?? [];

  return (
    <>
      <SearchInput
        value={searchInput}
        onChange={onSearchInputChange}
        ariaLabel={t("filters.search")}
        placeholder={t("list.searchPlaceholder")}
        clearLabel={t("filters.clearSearch")}
      />
      {hasSessions && (
        <FilterSelect
          label={t("filters.session")}
          allLabel={t("filters.allSessions")}
          value={sessionId}
          onChange={(pick) => {
            onChange({ session: toFilter(pick), term: FILTER_ALL });
          }}
          options={sessions}
        />
      )}
      {sessionId !== "" && terms.length > 0 && (
        <FilterSelect
          label={t("filters.term")}
          allLabel={t("filters.allTerms")}
          value={toPick(values.term)}
          onChange={(pick) => {
            onChange({ term: toFilter(pick) });
          }}
          options={terms}
        />
      )}
      <FilterSelect
        label={t("filters.status")}
        allLabel={t("filters.allStatuses")}
        value={toPick(values.status)}
        onChange={(pick) => {
          onChange({ status: toFilter(pick) });
        }}
        options={EXAM_STATUSES.map((status) => ({ id: status, name: t(`status.${status}`) }))}
      />
      <FilterSelect
        label={t("filters.type")}
        allLabel={t("filters.allTypes")}
        value={toPick(values.type)}
        onChange={(pick) => {
          onChange({ type: toFilter(pick) });
        }}
        options={EXAM_TYPES.map((type) => ({ id: type, name: t(`types.${type}`) }))}
      />
    </>
  );
}
