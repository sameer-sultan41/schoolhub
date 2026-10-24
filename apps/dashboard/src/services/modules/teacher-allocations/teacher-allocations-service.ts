import { fetchPage, MAX_PAGE_SIZE } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import {
  toAllocationCreateBody,
  toAllocationQueryParams,
  toAllocationSaveResult,
  toAllocationUpdateBody,
} from "./teacher-allocations-helper";
import type {
  AllocateTeacherInput,
  AllocationSaveResult,
  TeacherAllocationPageQuery,
  TeacherAllocationRecord,
  TeacherLoadRow,
  UpdateAllocationInput,
} from "./teacher-allocations-type";

/**
 * The teacher-allocations domain's API calls (`/teacher-subject-allocations`). Every
 * consumer reaches these through `Services.teacherAllocations.*` (see `@/services`) — never
 * by importing this file directly and never by importing `@schoolhub/api-client` directly.
 */

export async function fetchAllocationsPage(
  query: TeacherAllocationPageQuery,
): Promise<Page<TeacherAllocationRecord>> {
  return fetchPage<TeacherAllocationRecord>(apiClient, endpoints.teacherAllocations.list, {
    query: toAllocationQueryParams(query),
  });
}

/** A section's current allocations in one session: who teaches what there, for the grid's
 * teacher picker. One `MAX_PAGE_SIZE` page: a section has one row per subject teacher. */
export async function fetchSectionAllocations(
  academicSessionId: string,
  sectionId: string,
): Promise<TeacherAllocationRecord[]> {
  const { items } = await fetchAllocationsPage({
    academicSessionId,
    sectionId,
    current: true,
    pageSize: MAX_PAGE_SIZE,
  });
  return items;
}

/** Resolves with the over-norm warnings the answer's `meta` carries; the save still happened. */
export async function allocateTeacher(input: AllocateTeacherInput): Promise<AllocationSaveResult> {
  const { data, meta } = await apiClient.post<TeacherAllocationRecord>(
    endpoints.teacherAllocations.list,
    toAllocationCreateBody(input),
  );
  return toAllocationSaveResult(data, meta);
}

export async function updateAllocation(
  id: string,
  input: UpdateAllocationInput,
): Promise<AllocationSaveResult> {
  const { data, meta } = await apiClient.patch<TeacherAllocationRecord>(
    endpoints.teacherAllocations.detail(id),
    toAllocationUpdateBody(input),
  );
  return toAllocationSaveResult(data, meta);
}

/** Ends an allocation on `effectiveTo` (a date, not in the future); it stays as history. */
export async function endAllocation(
  id: string,
  effectiveTo: string,
): Promise<AllocationSaveResult> {
  return updateAllocation(id, { effectiveTo });
}

/** Makes an ended allocation current again; a reinstated primary replaces the current one. */
export async function reinstateAllocation(id: string): Promise<AllocationSaveResult> {
  return updateAllocation(id, { effectiveTo: null });
}

/** For a mistaken allocation; a reassignment ends the old one instead (`endAllocation`). */
export async function deleteAllocation(id: string): Promise<void> {
  await apiClient.delete(endpoints.teacherAllocations.detail(id));
}

/** Weekly teaching load per teacher for one academic session, against the norm. */
export async function fetchLoadSummary(academicSessionId: string): Promise<TeacherLoadRow[]> {
  const { data } = await apiClient.get<TeacherLoadRow[]>(endpoints.teacherAllocations.loadSummary, {
    query: { academic_session_id: academicSessionId },
  });
  return data;
}
