"use client";

import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@schoolhub/ui";

import { FilterSelect } from "@/components/filter-select";
import { SearchInput } from "@/components/search-input";
import { useCampuses, useClasses } from "@/hooks/use-reference-data";
import { SessionPicker } from "@/components/academic-session/session-picker";
import type { AcademicSessionSummary } from "@/services";
import { CURRICULUM_KIND } from "@/services/modules/curriculum/curriculum-constant";

export interface CurriculumFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  sessions: AcademicSessionSummary[] | undefined;
  /** The resolved session's id, or `""` when there is none. */
  sessionId: string;
  /** Called with a session's id, or `""` for the current session (the URL's default). */
  onSessionChange: (sessionId: string) => void;
  classId: string;
  onClassIdChange: (classId: string) => void;
  campusId: string;
  onCampusIdChange: (campusId: string) => void;
  kind: string;
  onKindChange: (kind: string) => void;
}

/**
 * The curriculum list's search box and its filters: session, class, campus and kind. The
 * values and setters come from the table's `useDataGridUrlState`. Each trigger carries an
 * `aria-label`, since none has a visible `<label>`.
 */
export function CurriculumFilters({
  searchInput,
  onSearchInputChange,
  sessions,
  sessionId,
  onSessionChange,
  classId,
  onClassIdChange,
  campusId,
  onCampusIdChange,
  kind,
  onKindChange,
}: CurriculumFiltersProps) {
  const t = useTranslations("academics");
  // Every class and campus, active or not: a past session's curriculum may name a class that
  // is no longer offered, and filtering by it is the point of looking at that session.
  const classesQuery = useClasses();
  const campusesQuery = useCampuses();

  return (
    <>
      <SearchInput
        value={searchInput}
        onChange={onSearchInputChange}
        ariaLabel={t("filters.search")}
        placeholder={t("curriculum.list.searchPlaceholder")}
        clearLabel={t("filters.clearSearch")}
      />
      <SessionPicker
        sessions={sessions}
        value={sessionId}
        onChange={onSessionChange}
        className="w-full sm:w-44"
      />
      <FilterSelect
        label={t("fields.class")}
        allLabel={t("filters.all")}
        value={classId}
        onChange={onClassIdChange}
        options={classesQuery.data ?? []}
      />
      <FilterSelect
        label={t("fields.campus")}
        allLabel={t("filters.all")}
        value={campusId}
        onChange={onCampusIdChange}
        options={campusesQuery.data ?? []}
      />
      <Select value={kind} onValueChange={onKindChange}>
        <SelectTrigger className="w-full sm:w-40" aria-label={t("curriculum.filters.kind")}>
          <SelectValue placeholder={t("curriculum.filters.kind")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CURRICULUM_KIND.all}>{t("filters.all")}</SelectItem>
          <SelectItem value={CURRICULUM_KIND.core}>{t("curriculum.core")}</SelectItem>
          <SelectItem value={CURRICULUM_KIND.elective}>{t("curriculum.elective")}</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}
