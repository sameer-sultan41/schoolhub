"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  STAFF_QUERY_MODULE,
  TEACHING_OPTIONS_RESOURCE,
} from "@/services/modules/staff/staff-constant";
import { toStaffOptions } from "@/services/modules/staff/staff-helper";

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

/** Every campus. */
export function useCampuses({ enabled = true }: ReferenceDataOptions = {}) {
  return useQuery({
    queryKey: queryKeys.list("school-organization", "campuses"),
    queryFn: () => Services.dashboard.fetchCampuses(),
    enabled,
  });
}

/** Classes: all of them, or only the active ones with `isActive: true`. */
export function useClasses({ isActive, enabled = true }: ActivityReferenceDataOptions = {}) {
  const params = isActive === undefined ? undefined : { isActive };
  return useQuery({
    queryKey: queryKeys.list("school-organization", "classes", params),
    queryFn: () => Services.schoolOrganization.fetchClasses(params),
    enabled,
  });
}

/** Subjects: all of them, or only the active ones with `isActive: true`. */
export function useSubjects({ isActive, enabled = true }: ActivityReferenceDataOptions = {}) {
  const params = isActive === undefined ? undefined : { isActive };
  return useQuery({
    queryKey: queryKeys.list("school-organization", "subjects", params),
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
    queryKey: queryKeys.list("school-organization", "sections", params),
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
