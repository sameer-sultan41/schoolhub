import { collectPages, MAX_PAGE_SIZE } from "@schoolhub/api-client";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { SITTING_STATUS_CANCELLED } from "./exam-schedules-constant";
import { conflictsFromMeta, toSittingBody } from "./exam-schedules-helper";
import type {
  ExamConflict,
  SchedulePublishResult,
  SittingInput,
  SittingRecord,
  SittingWriteResult,
} from "./exam-schedules-type";

/** The exam schedule's API calls (`/exam-schedules`, `/exams/{id}/schedule-conflicts`,
 * `/exams/{id}:publish-schedule`), reached through `Services.examSchedules.*`. */

/** Every sitting of one exam: the endpoint is cursor-paginated, so this follows the cursor. The
 * caller orders them (the day grouping does), so no `ordering` is sent: a cursor over tied dates
 * and times could skip or repeat a row between pages. */
export async function fetchSittings(examId: string): Promise<SittingRecord[]> {
  return collectPages<SittingRecord>(apiClient, endpoints.examSchedules.list, {
    query: { exam_id: examId, page_size: MAX_PAGE_SIZE },
  });
}

/** Create, update and cancel each answer with the sitting and the exam's whole clash list
 * (`meta.conflicts`). The schedule's callers put `conflicts` straight into the panel's cache
 * rather than reading `fetchConflicts` again. */
export async function createSitting(input: SittingInput): Promise<SittingWriteResult> {
  const { data, meta } = await apiClient.post<SittingRecord>(
    endpoints.examSchedules.list,
    toSittingBody(input),
  );
  return { sitting: data, conflicts: conflictsFromMeta(meta) };
}

export async function updateSitting(
  id: string,
  input: Partial<SittingInput>,
): Promise<SittingWriteResult> {
  const { data, meta } = await apiClient.patch<SittingRecord>(
    endpoints.examSchedules.detail(id),
    toSittingBody(input),
  );
  return { sitting: data, conflicts: conflictsFromMeta(meta) };
}

/** Cancelling is a status change, not a delete: the row stays visible and frees its room. */
export async function cancelSitting(id: string): Promise<SittingWriteResult> {
  const { data, meta } = await apiClient.patch<SittingRecord>(endpoints.examSchedules.detail(id), {
    status: SITTING_STATUS_CANCELLED,
  });
  return { sitting: data, conflicts: conflictsFromMeta(meta) };
}

export async function deleteSitting(id: string): Promise<void> {
  await apiClient.delete(endpoints.examSchedules.detail(id));
}

/** The exam's clash list on a fresh read, hard findings first. */
export async function fetchConflicts(examId: string): Promise<ExamConflict[]> {
  const { data } = await apiClient.get<ExamConflict[]>(endpoints.exams.scheduleConflicts(examId));
  return data;
}

/** A 422 with the whole list in `error.meta.conflicts` when a hard clash stands. */
export async function publishSchedule(examId: string): Promise<SchedulePublishResult> {
  const { data } = await apiClient.post<SchedulePublishResult>(
    endpoints.exams.publishSchedule(examId),
  );
  return data;
}
