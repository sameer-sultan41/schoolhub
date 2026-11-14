"use client";

import { useCurrentUser } from "@/hooks/use-current-user";
import { useAcademicSessions, useCampuses, useClasses } from "@/hooks/use-reference-data";
import { hasPermission } from "@/lib/permissions";

/**
 * The campuses, sessions and classes the report filters pick from. Each list is read only for a
 * holder of its own view key (L55), so a viewer without one gets no picker for it, never a failed
 * request; a filter a shared link already names still applies.
 */
export function useReportReferences() {
  const { data: user } = useCurrentUser();
  const canReadCampuses = hasPermission(user, "school.campus.view");
  const canReadSessions = hasPermission(user, "school.academic-session.view");
  const canReadClasses = hasPermission(user, "school.class.view");
  const canReadStudents = hasPermission(user, "students.student.view");

  const campuses = useCampuses({ enabled: canReadCampuses });
  const sessions = useAcademicSessions({ enabled: canReadSessions });
  const classes = useClasses({ enabled: canReadClasses });

  return {
    campuses: canReadCampuses ? (campuses.data ?? []) : null,
    sessions: canReadSessions ? (sessions.data ?? []) : null,
    classes: canReadClasses ? (classes.data ?? []) : null,
    canReadStudents,
  };
}
