"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useCurrentUser } from "@/hooks/use-current-user";
import { useCampuses, useClasses } from "@/hooks/use-reference-data";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";

export interface NamedOption {
  id: string;
  name: string;
}

/** An empty array kept stable, so a memo over a list that is not read yet does not rebuild. */
const NONE: readonly NamedOption[] = [];

/**
 * The sessions, classes and campuses a fee structure is scoped to: the options a picker or
 * filter offers, and each id's name for a table cell. Each list is read only for a holder of its
 * view key (L55), so a viewer without one sees no picker and an unnamed cell, never a failed
 * request. They share the cache entries the other screens read these lists under.
 */
export function useStructureReferences() {
  const { data: user } = useCurrentUser();
  const canReadSessions = hasPermission(user, "school.academic-session.view");
  const canReadClasses = hasPermission(user, "school.class.view");
  const canReadCampuses = hasPermission(user, "school.campus.view");

  const sessionsQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "academic-sessions"),
    queryFn: () => Services.schoolOrganization.fetchAcademicSessions(),
    enabled: canReadSessions,
  });
  const classesQuery = useClasses({ enabled: canReadClasses });
  const campusesQuery = useCampuses({ enabled: canReadCampuses });

  const sessions: readonly NamedOption[] = sessionsQuery.data ?? NONE;
  const classes: readonly NamedOption[] = classesQuery.data ?? NONE;
  const campuses: readonly NamedOption[] = campusesQuery.data ?? NONE;

  const names = useMemo(() => {
    const byId = (options: readonly NamedOption[]) =>
      new Map(options.map((option) => [option.id, option.name]));
    return { sessions: byId(sessions), classes: byId(classes), campuses: byId(campuses) };
  }, [sessions, classes, campuses]);

  return {
    sessions,
    classes,
    campuses,
    names,
    canReadSessions,
    canReadClasses,
    canReadCampuses,
    isLoading: sessionsQuery.isLoading || classesQuery.isLoading || campusesQuery.isLoading,
  };
}
