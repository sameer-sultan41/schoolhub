import { collectPages } from "@schoolhub/api-client";
import { useQuery } from "@tanstack/react-query";
import type { SubjectOption, TeachingStaffOption } from "@/features/academics/academics-types";
import type { SectionOption } from "@/features/students/enrollment-types";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

/**
 * Bounded option lists the academics screens need on top of the ones
 * students/use-reference-data.ts already provides (campuses, sessions, classes,
 * sections-for-one-class).
 *
 * `collectPages`, not `fetchPage`: these fill Selects, where a half-drained list
 * silently hides a valid choice. Cached far longer than the default, with
 * staleTime and gcTime set explicitly together — a custom staleTime above the
 * 5-minute default must carry its own gcTime or the entry can be evicted before
 * it goes stale (students/use-reference-data.ts explains the same pairing).
 *
 * Keyed under the module that OWNS the resource, not under "academics": these
 * are school-organization and staff records, and an academics mutation
 * invalidating `queryKeys.module("academics")` has no business dropping them.
 */
const REFERENCE_DATA_STALE_TIME_MS = 10 * 60_000;
const REFERENCE_DATA_GC_TIME_MS = 15 * 60_000;

export function useSubjects() {
  return useQuery({
    queryKey: queryKeys.list("school-organization", "subjects"),
    queryFn: () => collectPages<SubjectOption>(apiClient, "/subjects"),
    staleTime: REFERENCE_DATA_STALE_TIME_MS,
    gcTime: REFERENCE_DATA_GC_TIME_MS,
  });
}

/** Every section, across classes — the allocation grid filters by section
 * without first pinning a class, unlike the enrollment dialogs. */
export function useSections() {
  return useQuery({
    queryKey: queryKeys.list("school-organization", "sections", { scope: "all" }),
    queryFn: () => collectPages<SectionOption>(apiClient, "/sections"),
    staleTime: REFERENCE_DATA_STALE_TIME_MS,
    gcTime: REFERENCE_DATA_GC_TIME_MS,
  });
}

/**
 * Teachers eligible for an allocation. §11 requires active teaching staff, and
 * `services.create_allocation` rejects anything else — filtering here means the
 * Select cannot offer a choice the server will refuse.
 */
export function useTeachingStaff() {
  return useQuery({
    queryKey: queryKeys.list("staff", "teaching-staff"),
    queryFn: () =>
      collectPages<TeachingStaffOption>(apiClient, "/staff", {
        query: { staff_type: "teaching", employment_status: "active" },
      }),
    staleTime: REFERENCE_DATA_STALE_TIME_MS,
    gcTime: REFERENCE_DATA_GC_TIME_MS,
  });
}
