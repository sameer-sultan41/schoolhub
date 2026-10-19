import { collectPages, MAX_PAGE_SIZE } from "@schoolhub/api-client";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { conflictsFromMeta, toSlotBody } from "./timetable-slots-helper";
import type {
  SlotInput,
  SlotWriteResult,
  TimetablePublishResult,
  TimetableSlotRecord,
  TimetableValidation,
} from "./timetable-slots-type";

/** The week grid's API calls (`/timetable-slots`, `/timetables/{section}:…`), reached
 * through `Services.timetableSlots.*`. */

/**
 * One section's current cells in one session: drafts and live published rows, never
 * superseded history. Every page, not one, at `MAX_PAGE_SIZE`: a week is forty-odd cells, and
 * a page boundary through Wednesday would hide real cells. The ordering is unique
 * (`period_sequence` ties across five weekdays and across a draft and the published row it
 * replaces), because a cursor over tied rows can skip or repeat one between pages.
 */
export async function fetchSectionSlots(
  academicSessionId: string,
  sectionId: string,
): Promise<TimetableSlotRecord[]> {
  return collectPages<TimetableSlotRecord>(apiClient, endpoints.timetableSlots.list, {
    query: {
      academic_session_id: academicSessionId,
      section_id: sectionId,
      current: true,
      ordering: "period_sequence,day_of_week,created_at",
      page_size: MAX_PAGE_SIZE,
    },
  });
}

export async function createSlot(input: SlotInput): Promise<SlotWriteResult> {
  const { data, meta } = await apiClient.post<TimetableSlotRecord>(
    endpoints.timetableSlots.list,
    toSlotBody(input),
  );
  return { slot: data, conflicts: conflictsFromMeta(meta) };
}

export async function updateSlot(id: string, input: Partial<SlotInput>): Promise<SlotWriteResult> {
  const { data, meta } = await apiClient.patch<TimetableSlotRecord>(
    endpoints.timetableSlots.detail(id),
    toSlotBody(input),
  );
  return { slot: data, conflicts: conflictsFromMeta(meta) };
}

/** A 200 with `data: null` and the section's remaining conflicts, not the usual 204. */
export async function deleteSlot(id: string): Promise<SlotWriteResult> {
  const { meta } = await apiClient.delete<null>(endpoints.timetableSlots.detail(id));
  return { slot: null, conflicts: conflictsFromMeta(meta) };
}

export async function validateSection(
  sectionId: string,
  academicSessionId: string,
): Promise<TimetableValidation> {
  const { data } = await apiClient.post<TimetableValidation>(
    endpoints.timetableSlots.validate(sectionId),
    { academic_session_id: academicSessionId },
  );
  return data;
}

/** A 422 with the hard findings in `error.meta.conflicts` when the grid isn't clear. */
export async function publishSection(
  sectionId: string,
  academicSessionId: string,
): Promise<TimetablePublishResult> {
  const { data } = await apiClient.post<TimetablePublishResult>(
    endpoints.timetableSlots.publish(sectionId),
    { academic_session_id: academicSessionId },
  );
  return data;
}
