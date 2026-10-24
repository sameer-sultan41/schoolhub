import { collectPages, MAX_PAGE_SIZE } from "@schoolhub/api-client";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { SLOT_LIST_ORDERING, SLOT_STATUS_PUBLISHED } from "./timetable-slots-constant";
import { conflictsFromMeta, toSlotBody } from "./timetable-slots-helper";
import type {
  EffectiveSlotRecord,
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
      ordering: SLOT_LIST_ORDERING,
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

/**
 * The viewer's own week: a teacher's classes (and cover they give), a student's or guardian's
 * section. With a `date`, the version in force that day with confirmed cover applied; without
 * one, the current week. One list, not paged: the API answers the week whole.
 */
export async function fetchMyTimetable(date?: string): Promise<EffectiveSlotRecord[]> {
  const { data } = await apiClient.get<EffectiveSlotRecord[]>(endpoints.timetableSlots.my, {
    query: date === undefined ? {} : { date },
  });
  return data;
}

/** One teacher's live published classes on a weekday in a session: what their absence leaves
 * to cover. */
export async function fetchTeacherClassesOn(
  academicSessionId: string,
  staffId: string,
  dayOfWeek: number,
): Promise<TimetableSlotRecord[]> {
  return collectPages<TimetableSlotRecord>(apiClient, endpoints.timetableSlots.list, {
    query: {
      academic_session_id: academicSessionId,
      teacher_id: staffId,
      weekday: dayOfWeek,
      status: SLOT_STATUS_PUBLISHED,
      current: true,
      ordering: SLOT_LIST_ORDERING,
      page_size: MAX_PAGE_SIZE,
    },
  });
}
