import { collectPages } from "@schoolhub/api-client";
import { useQuery } from "@tanstack/react-query";
import type {
  CampusOption,
  PeriodRecord,
  RoomRecord,
  SectionOption,
  SubjectOption,
  TeachingStaffOption,
} from "@/features/timetable/timetable-types";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

/**
 * Bounded option lists the timetable screens fill their Selects from.
 *
 * `collectPages`, not `fetchPage`: a half-drained list silently hides a valid
 * choice, and "the room I need is missing from the dropdown" is indistinguishable
 * from "that room does not exist". Paged *tables* still use `fetchPage` — see
 * periods-screen.tsx.
 *
 * staleTime and gcTime are set explicitly together: a custom staleTime above the
 * 5-minute default must carry its own gcTime or the entry can be evicted before
 * it goes stale (students/use-reference-data.ts explains the same pairing).
 *
 * Keyed under the module that OWNS the resource. Periods and rooms are the
 * timetable's own, so they sit under "timetable" and a period edit invalidating
 * `queryKeys.module("timetable")` correctly refreshes them; sections, subjects,
 * campuses and staff belong to other modules and must survive that invalidation.
 */
const REFERENCE_DATA_STALE_TIME_MS = 10 * 60_000;
const REFERENCE_DATA_GC_TIME_MS = 15 * 60_000;

/** Every period of the bell schedule, ordered by `sequence` server-side
 * (models.Period.Meta.ordering) — the grid's rows, in the order the day runs. */
export function usePeriodOptions() {
  return useQuery({
    queryKey: queryKeys.list("timetable", "periods", { scope: "all" }),
    queryFn: () => collectPages<PeriodRecord>(apiClient, "/periods"),
    staleTime: REFERENCE_DATA_STALE_TIME_MS,
    gcTime: REFERENCE_DATA_GC_TIME_MS,
  });
}

/** Only active rooms: an inactive room is one the school has taken out of
 * service, and offering it would be offering a choice the grid should not make. */
export function useRoomOptions() {
  return useQuery({
    queryKey: queryKeys.list("timetable", "rooms", { is_active: true }),
    queryFn: () => collectPages<RoomRecord>(apiClient, "/rooms", { query: { is_active: true } }),
    staleTime: REFERENCE_DATA_STALE_TIME_MS,
    gcTime: REFERENCE_DATA_GC_TIME_MS,
  });
}

export function useCampusOptions() {
  return useQuery({
    queryKey: queryKeys.list("school-organization", "campuses"),
    queryFn: () => collectPages<CampusOption>(apiClient, "/campuses"),
    staleTime: REFERENCE_DATA_STALE_TIME_MS,
    gcTime: REFERENCE_DATA_GC_TIME_MS,
  });
}

/** Every section, across classes — the grid picks a section without first
 * pinning a class, unlike the enrollment dialogs. */
export function useSectionOptions() {
  return useQuery({
    queryKey: queryKeys.list("school-organization", "sections", { scope: "all" }),
    queryFn: () => collectPages<SectionOption>(apiClient, "/sections"),
    staleTime: REFERENCE_DATA_STALE_TIME_MS,
    gcTime: REFERENCE_DATA_GC_TIME_MS,
  });
}

export function useSubjectOptions() {
  return useQuery({
    queryKey: queryKeys.list("school-organization", "subjects"),
    queryFn: () => collectPages<SubjectOption>(apiClient, "/subjects"),
    staleTime: REFERENCE_DATA_STALE_TIME_MS,
    gcTime: REFERENCE_DATA_GC_TIME_MS,
  });
}

/**
 * Teachers a slot may be assigned to. `services.assert_staff_is_active_teacher`
 * rejects anything that is not active *and* teaching, so filtering here means the
 * Select cannot offer a choice the server will refuse.
 *
 * It does NOT filter by allocation: the teacher-must-hold-an-allocation rule is a
 * hard conflict rather than a save-time refusal (conflicts._unallocated_teachers),
 * because a draft is allowed to hold conflicts while it is being worked on.
 */
export function useTeachingStaffOptions() {
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
