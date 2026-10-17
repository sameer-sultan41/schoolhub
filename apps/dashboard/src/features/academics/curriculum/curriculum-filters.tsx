"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";
import { Search, X } from "lucide-react";

import { FILTER_ALL as ALL } from "@/lib/constants";
import { queryKeys } from "@/lib/query-client";
import { SessionPicker } from "@/features/academics/session-picker";
import { Services, type AcademicSessionSummary } from "@/services";
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
  const classesQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "classes"),
    queryFn: () => Services.schoolOrganization.fetchClasses(),
  });
  const campusesQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "campuses"),
    queryFn: () => Services.dashboard.fetchCampuses(),
  });

  return (
    <>
      <div className="relative w-full sm:w-auto">
        <Search
          className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-primary"
          aria-hidden="true"
        />
        <Input
          aria-label={t("filters.search")}
          placeholder={t("curriculum.list.searchPlaceholder")}
          value={searchInput}
          onChange={(event) => {
            onSearchInputChange(event.target.value);
          }}
          // `pe-8` clears the trailing clear button, so long text never runs underneath it.
          className="w-full ps-9 pe-8 sm:max-w-64"
        />
        {searchInput.length > 0 && (
          <Button
            mode="icon"
            variant="ghost"
            aria-label={t("filters.clearSearch")}
            className="absolute end-1.5 top-1/2 h-6 w-6 -translate-y-1/2"
            onClick={() => {
              onSearchInputChange("");
            }}
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
      <SessionPicker
        sessions={sessions}
        value={sessionId}
        onChange={onSessionChange}
        className="w-full sm:w-44"
      />
      <Select
        value={classId || ALL}
        onValueChange={(value) => {
          onClassIdChange(value === ALL ? "" : value);
        }}
      >
        <SelectTrigger className="w-full sm:w-40" aria-label={t("fields.class")}>
          <SelectValue placeholder={t("fields.class")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
          {(classesQuery.data ?? []).map((schoolClass) => (
            <SelectItem key={schoolClass.id} value={schoolClass.id}>
              {schoolClass.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={campusId || ALL}
        onValueChange={(value) => {
          onCampusIdChange(value === ALL ? "" : value);
        }}
      >
        <SelectTrigger className="w-full sm:w-40" aria-label={t("fields.campus")}>
          <SelectValue placeholder={t("fields.campus")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
          {(campusesQuery.data ?? []).map((campus) => (
            <SelectItem key={campus.id} value={campus.id}>
              {campus.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
