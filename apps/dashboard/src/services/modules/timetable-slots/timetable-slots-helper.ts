import { ApiError } from "@schoolhub/api-client";
import type { ApiMeta } from "@schoolhub/types";

import { copyMappedFields } from "@/lib/helpers";
import { toShortTime } from "@/services/modules/periods/periods-helper";
import {
  CONFLICT_SEVERITIES,
  DEFAULT_VISIBLE_WEEKDAYS,
  ALL_WEEKDAYS,
  SLOT_BODY_FIELDS,
} from "./timetable-slots-constant";
import type { SlotFormValues } from "./timetable-slots.schema";
import type { SlotInput, TimetableConflict, TimetableSlotRecord } from "./timetable-slots-type";

/** The grid's pure helpers: plain data in, plain data out. */

/** `SlotInput` -> the API body; `null` is kept (it clears a pick). */
export function toSlotBody(input: Partial<SlotInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, SLOT_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

/** A finding as the grid treats it: an unknown severity counts as hard. */
function normalizeConflict(raw: TimetableConflict): TimetableConflict {
  return CONFLICT_SEVERITIES.includes(raw.severity) ? raw : { ...raw, severity: "hard" };
}

/** A conflict list from a loosely typed place (`meta`, an error's `meta`), in the server's
 * order. A missing or malformed list is no findings, never a crash. */
function readConflictList(value: unknown): TimetableConflict[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is TimetableConflict =>
        typeof item === "object" &&
        item !== null &&
        Array.isArray((item as Partial<TimetableConflict>).slot_ids),
    )
    .map(normalizeConflict);
}

/** A slot write's `meta.conflicts`: the envelope's `meta` is not generated, so this is the one
 * place the generated `TimetableConflict` shape is applied to it. */
export function conflictsFromMeta(meta: ApiMeta | undefined): TimetableConflict[] {
  return readConflictList(meta?.conflicts);
}

/** A refused `:publish`'s findings, carried in the error's `meta` (never `details`, which the
 * server flattens and which would lose all but one `slot_ids` entry). */
export function conflictsFromError(error: unknown): TimetableConflict[] {
  return error instanceof ApiError ? readConflictList(error.meta.conflicts) : [];
}

/** Every finding filed under each slot it names, so both sides of a clash can show it. */
export function conflictsBySlot(
  conflicts: readonly TimetableConflict[],
): Map<string, TimetableConflict[]> {
  const index = new Map<string, TimetableConflict[]>();
  for (const conflict of conflicts) {
    for (const slotId of conflict.slot_ids) {
      index.set(slotId, [...(index.get(slotId) ?? []), conflict]);
    }
  }
  return index;
}

export function hasHardConflicts(conflicts: readonly TimetableConflict[]): boolean {
  return conflicts.some((conflict) => conflict.severity === "hard");
}

/** One cell's key in the grid index. */
export function cellKey(dayOfWeek: number, periodId: string): string {
  return `${dayOfWeek}:${periodId}`;
}

/** What one cell holds: the slot shown, and whether a published slot sits under a draft. */
export interface GridCell {
  slot: TimetableSlotRecord;
  /** A draft replacing a published cell: it publishes over it. */
  replacesPublished: boolean;
}

/**
 * The section's current slots indexed by cell. A published row and the draft that will
 * replace it are both current; the draft is what the builder edits, so it wins the cell.
 * Superseded rows (`effective_to` set) are skipped even if a caller passes them.
 */
export function buildCellIndex(slots: readonly TimetableSlotRecord[]): Map<string, GridCell> {
  const index = new Map<string, GridCell>();
  for (const slot of slots) {
    if (slot.effective_to) continue;
    const key = cellKey(slot.day_of_week, slot.period_id);
    const existing = index.get(key);
    if (!existing) {
      index.set(key, { slot, replacesPublished: false });
    } else if (slot.status === "draft" && existing.slot.status === "published") {
      index.set(key, { slot, replacesPublished: true });
    } else if (slot.status === "published" && existing.slot.status === "draft") {
      index.set(key, { ...existing, replacesPublished: true });
    }
  }
  return index;
}

/** The week's columns: Monday to Friday, plus any weekend day that holds a cell, so a
 * Saturday school is never cut short. */
export function visibleWeekdays(slots: readonly { day_of_week: number }[]): number[] {
  const scheduled = new Set(slots.map((slot) => slot.day_of_week));
  return ALL_WEEKDAYS.filter((day) => DEFAULT_VISIBLE_WEEKDAYS.includes(day) || scheduled.has(day));
}

/** Whether a period runs on `day`: a null list is the tenant's working days, every column. */
export function periodRunsOn(weekdays: readonly number[] | null | undefined, day: number) {
  return !weekdays || weekdays.length === 0 || weekdays.includes(day);
}

/** A cell's form values: the slot's picks, or empty for a new cell. */
export function slotToFormValues(slot: TimetableSlotRecord | undefined): SlotFormValues {
  return {
    subject_id: slot?.subject_id ?? "",
    staff_id: slot?.staff_id ?? "",
    room_id: slot?.room_id ?? "",
    notes: slot?.notes ?? "",
  };
}

/** Form values for one cell -> the write; an empty pick or note is `null`, which clears it. */
export function buildSlotInput(
  values: SlotFormValues,
  cell: { academicSessionId: string; sectionId: string; dayOfWeek: number; periodId: string },
): SlotInput {
  const notes = values.notes.trim();
  // Field by field, not `...cell`: a caller's cell context carries more than the write (a
  // label, the class and campus), and none of it belongs in a slot's input.
  return {
    academicSessionId: cell.academicSessionId,
    sectionId: cell.sectionId,
    dayOfWeek: cell.dayOfWeek,
    periodId: cell.periodId,
    subjectId: values.subject_id || null,
    staffId: values.staff_id || null,
    roomId: values.room_id || null,
    notes: notes === "" ? null : notes,
  };
}

/** A teacher as the cell form offers one. */
export interface TeacherChoice {
  id: string;
  name: string;
  /** Allocated to this section and subject in academics: no `teacher_not_allocated`. */
  allocated: boolean;
}

/**
 * Every teaching staff member, those allocated to the section and subject first (each group
 * keeps the incoming order). An unallocated pick stays possible: it saves, and the conflict
 * engine reports it, which is how a grid mid-build is meant to work.
 */
export function orderTeachersByAllocation(
  teachers: readonly { id: string; name: string }[],
  allocations: readonly { staff_id: string; subject_id: string }[],
  subjectId: string,
): TeacherChoice[] {
  const allocated = new Set(
    allocations.filter((row) => row.subject_id === subjectId).map((row) => row.staff_id),
  );
  const choices = teachers.map((teacher) => ({ ...teacher, allocated: allocated.has(teacher.id) }));
  return [...choices.filter((c) => c.allocated), ...choices.filter((c) => !c.allocated)];
}

/** A period's span as `08:00–08:45`, from the API's `HH:MM:SS`. */
export function toShortTimeRange(start: string, end: string): string {
  return `${toShortTime(start)}–${toShortTime(end)}`;
}
