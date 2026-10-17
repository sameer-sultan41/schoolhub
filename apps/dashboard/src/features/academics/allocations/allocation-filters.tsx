"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@schoolhub/ui";

import { FilterSelect } from "@/components/filter-select";
import { SearchInput } from "@/components/search-input";
import { SessionPicker } from "@/features/academics/session-picker";
import { useClasses, useSections, useSubjects } from "@/hooks/use-reference-data";
import type { AcademicSessionSummary } from "@/services";
import { ALLOCATION_STATE } from "@/services/modules/teacher-allocations/teacher-allocations-constant";
import { useTeachingStaffOptions } from "./use-teaching-staff-options";

export interface AllocationFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  sessions: AcademicSessionSummary[] | undefined;
  /** The resolved session's id, or `""` when there is none. */
  sessionId: string;
  /** Called with a session's id, or `""` for the current session (the URL's default). */
  onSessionChange: (sessionId: string) => void;
  classId: string;
  /** The table clears the section in the same write as a class change. */
  onClassIdChange: (classId: string) => void;
  sectionId: string;
  /** Stable: the stale-section effect below runs again when it changes. */
  onSectionIdChange: (sectionId: string) => void;
  subjectId: string;
  onSubjectIdChange: (subjectId: string) => void;
  teacherId: string;
  onTeacherIdChange: (teacherId: string) => void;
  state: string;
  onStateChange: (state: string) => void;
}

/** The list's search box and filters; the values and setters come from the table's URL state. */
export function AllocationFilters({
  searchInput,
  onSearchInputChange,
  sessions,
  sessionId,
  onSessionChange,
  classId,
  onClassIdChange,
  sectionId,
  onSectionIdChange,
  subjectId,
  onSubjectIdChange,
  teacherId,
  onTeacherIdChange,
  state,
  onStateChange,
}: AllocationFiltersProps) {
  const t = useTranslations("academics");
  // Every class, subject and section, active or not: a past session's allocations may name
  // one that is no longer offered, and filtering by it is the point of looking at that session.
  // Teachers are the exception: only active teaching staff are offered (see docs/deferred-work.md).
  const classesQuery = useClasses();
  const sectionsQuery = useSections(classId);
  const subjectsQuery = useSubjects();
  const teachersQuery = useTeachingStaffOptions();

  // A section from a link or an old URL that isn't one of this class's sections is dropped
  // once the list loads, so it never filters the list.
  const sections = sectionsQuery.data;
  const sectionIsStale =
    sectionId !== "" && sections !== undefined && !sections.some((s) => s.id === sectionId);
  useEffect(() => {
    if (sectionIsStale) onSectionIdChange("");
  }, [sectionIsStale, onSectionIdChange]);

  return (
    <>
      <SearchInput
        value={searchInput}
        onChange={onSearchInputChange}
        ariaLabel={t("filters.search")}
        placeholder={t("allocations.list.searchPlaceholder")}
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
        label={t("fields.section")}
        allLabel={t("filters.all")}
        value={sectionId}
        onChange={onSectionIdChange}
        options={sections ?? []}
        disabled={classId === ""}
      />
      <FilterSelect
        label={t("fields.subject")}
        allLabel={t("filters.all")}
        value={subjectId}
        onChange={onSubjectIdChange}
        options={subjectsQuery.data ?? []}
      />
      <FilterSelect
        label={t("fields.teacher")}
        allLabel={t("filters.all")}
        value={teacherId}
        onChange={onTeacherIdChange}
        options={teachersQuery.data ?? []}
      />
      <Select value={state} onValueChange={onStateChange}>
        <SelectTrigger className="w-full sm:w-40" aria-label={t("allocations.filters.state")}>
          <SelectValue placeholder={t("allocations.filters.state")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALLOCATION_STATE.current}>
            {t("allocations.filters.current")}
          </SelectItem>
          <SelectItem value={ALLOCATION_STATE.ended}>{t("allocations.filters.ended")}</SelectItem>
          <SelectItem value={ALLOCATION_STATE.all}>{t("filters.all")}</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}
