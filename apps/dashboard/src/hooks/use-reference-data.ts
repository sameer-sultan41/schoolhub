"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { SCHOOL_ORGANIZATION_QUERY_MODULE } from "@/services/modules/school-organization/school-organization-constant";
import {
  STAFF_QUERY_MODULE,
  TEACHING_OPTIONS_RESOURCE,
} from "@/services/modules/staff/staff-constant";
import { toStaffOptions } from "@/services/modules/staff/staff-helper";

/** The query-key resource the term list lives under. */
const TERMS_RESOURCE = "terms";

/**
 * The school-organization lists a form or a filter picks from. Each hook uses the key the
 * other readers of that list use, so every screen shares one cache entry and a list is
 * requested once. They return the `useQuery` result.
 */

export interface ReferenceDataOptions {
  /** Whether to request the list yet. Defaults to true. */
  enabled?: boolean;
}

export interface ActivityReferenceDataOptions extends ReferenceDataOptions {
  /** Omitted: every record, active or not (a filter). `true`: only live ones (a picker). */
  isActive?: boolean;
}

/** Campuses: all of them, or only the active ones with `isActive: true`. */
export function useCampuses({ isActive, enabled = true }: ActivityReferenceDataOptions = {}) {
  const params = isActive === undefined ? undefined : { isActive };
  return useQuery({
    queryKey: queryKeys.list(SCHOOL_ORGANIZATION_QUERY_MODULE, "campuses", params),
    queryFn: () =>
      params ? Services.dashboard.fetchCampuses(params) : Services.dashboard.fetchCampuses(),
    enabled,
  });
}

/** Every department; the staff form reads the same list under the same key. */
export function useDepartments({ enabled = true }: ReferenceDataOptions = {}) {
  return useQuery({
    queryKey: queryKeys.list(SCHOOL_ORGANIZATION_QUERY_MODULE, "departments"),
    queryFn: () => Services.dashboard.fetchDepartments(),
    enabled,
  });
}

/** Every academic session, newest first as the API orders them. */
export function useAcademicSessions({ enabled = true }: ReferenceDataOptions = {}) {
  return useQuery({
    queryKey: queryKeys.list(SCHOOL_ORGANIZATION_QUERY_MODULE, "academic-sessions"),
    queryFn: () => Services.schoolOrganization.fetchAcademicSessions(),
    enabled,
  });
}

/** Classes: all of them, or only the active ones with `isActive: true`. */
export function useClasses({ isActive, enabled = true }: ActivityReferenceDataOptions = {}) {
  const params = isActive === undefined ? undefined : { isActive };
  return useQuery({
    queryKey: queryKeys.list(SCHOOL_ORGANIZATION_QUERY_MODULE, "classes", params),
    queryFn: () => Services.schoolOrganization.fetchClasses(params),
    enabled,
  });
}

/** Subjects: all of them, or only the active ones with `isActive: true`. */
export function useSubjects({ isActive, enabled = true }: ActivityReferenceDataOptions = {}) {
  const params = isActive === undefined ? undefined : { isActive };
  return useQuery({
    queryKey: queryKeys.list(SCHOOL_ORGANIZATION_QUERY_MODULE, "subjects", params),
    queryFn: () => Services.schoolOrganization.fetchSubjects(params),
    enabled,
  });
}

/**
 * One class's sections: all of them, or only the active ones with `isActive: true`. Not
 * requested until `classId` is set (`""` means none).
 */
export function useSections(classId: string, { isActive }: { isActive?: boolean } = {}) {
  const params = isActive === undefined ? { classId } : { classId, isActive };
  return useQuery({
    queryKey: queryKeys.list(SCHOOL_ORGANIZATION_QUERY_MODULE, "sections", params),
    queryFn: () => Services.schoolOrganization.fetchSections(params),
    enabled: classId !== "",
  });
}

/** The active teachers a picker offers (allocations, the timetable grid); one cache entry. */
export function useTeachingStaffOptions() {
  return useQuery({
    queryKey: queryKeys.list(STAFF_QUERY_MODULE, TEACHING_OPTIONS_RESOURCE),
    queryFn: () => Services.staff.fetchTeachingStaffOptions(),
    select: toStaffOptions,
  });
}

/** One session's terms, in their order. Not requested until `sessionId` is set (`""` means none). */
export function useTerms(sessionId: string) {
  return useQuery({
    queryKey: queryKeys.list(SCHOOL_ORGANIZATION_QUERY_MODULE, TERMS_RESOURCE, {
      academicSessionId: sessionId,
    }),
    queryFn: () => Services.schoolOrganization.fetchTerms(sessionId),
    enabled: sessionId !== "",
  });
}
