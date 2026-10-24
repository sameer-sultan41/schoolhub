"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAcademicSession } from "@/components/academic-session/use-academic-session";
import { useSections } from "@/hooks/use-reference-data";
import { useUrlParams } from "@/hooks/use-url-params";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  PERIODS_FOR_CAMPUS_RESOURCE,
  PERIODS_QUERY_MODULE,
} from "@/services/modules/periods/periods-constant";
import {
  GRID_URL_KEYS,
  isGridUrlId,
  TIMETABLE_GRID_RESOURCE,
  TIMETABLE_SLOTS_QUERY_MODULE,
} from "@/services/modules/timetable-slots/timetable-slots-constant";
import {
  buildCellIndex,
  visibleWeekdays,
} from "@/services/modules/timetable-slots/timetable-slots-helper";

/** A URL id, or `""` when it is missing or isn't a UUID (never sent to the API). */
function urlId(value: string | null): string {
  return value && isGridUrlId(value) ? value : "";
}

/** The query key of one section's grid; the dialogs refresh it after a write. */
export function gridQueryKey(academicSessionId: string, sectionId: string) {
  return queryKeys.list(TIMETABLE_SLOTS_QUERY_MODULE, TIMETABLE_GRID_RESOURCE, {
    academicSessionId,
    sectionId,
  });
}

/**
 * Everything the week grid draws, from the URL's session, class and section: the section's
 * campus periods (rows), its current cells, the draft-wins cell index and the weekday columns.
 * Each request waits for what it depends on; nothing is asked for until a section is picked.
 */
export function useWeekGrid() {
  const { searchParams, setParams } = useUrlParams();
  const sessionParam = urlId(searchParams.get(GRID_URL_KEYS.session));
  const classId = urlId(searchParams.get(GRID_URL_KEYS.class));
  const sectionParam = urlId(searchParams.get(GRID_URL_KEYS.section));

  const sessionState = useAcademicSession(sessionParam);
  const sectionsQuery = useSections(classId);
  const section = sectionsQuery.data?.find((candidate) => candidate.id === sectionParam) ?? null;
  const academicSessionId = sessionState.session?.id ?? "";
  const campusId = section?.campus_id ?? "";

  const periodsQuery = useQuery({
    queryKey: queryKeys.list(PERIODS_QUERY_MODULE, PERIODS_FOR_CAMPUS_RESOURCE, { campusId }),
    queryFn: () => Services.periods.fetchCampusPeriods(campusId),
    enabled: campusId !== "",
  });

  const slotsQuery = useQuery({
    queryKey: gridQueryKey(academicSessionId, section?.id ?? ""),
    queryFn: () => Services.timetableSlots.fetchSectionSlots(academicSessionId, section?.id ?? ""),
    enabled: academicSessionId !== "" && section !== null,
  });

  const slots = useMemo(() => slotsQuery.data ?? [], [slotsQuery.data]);
  const cells = useMemo(() => buildCellIndex(slots), [slots]);
  const weekdays = useMemo(() => visibleWeekdays(slots), [slots]);

  /** Picking a session, class or section; a new class clears the section it no longer has. */
  function pick(key: keyof typeof GRID_URL_KEYS, value: string) {
    if (key === "class") {
      setParams({ [GRID_URL_KEYS.class]: value || null, [GRID_URL_KEYS.section]: null });
      return;
    }
    setParams({ [GRID_URL_KEYS[key]]: value || null });
  }

  return {
    ...sessionState,
    classId,
    sectionId: sectionParam,
    sections: sectionsQuery.data,
    section,
    academicSessionId,
    campusId,
    periods: periodsQuery.data,
    slots,
    cells,
    weekdays,
    periodsQuery,
    slotsQuery,
    pick,
  };
}

export type WeekGridState = ReturnType<typeof useWeekGrid>;
