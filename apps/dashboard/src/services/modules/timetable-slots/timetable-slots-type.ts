import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). */
export type TimetableSlotRecord = ApiSchemas["TimetableSlot"];
export type TimetableConflict = ApiSchemas["TimetableConflict"];
export type TimetableValidation = ApiSchemas["TimetableValidation"];
export type TimetablePublishResult = ApiSchemas["TimetablePublishResult"];
export type ConflictSeverity = TimetableConflict["severity"];
/** One cell of the viewer's own week (`/timetables/my`), with cover applied for a date. */
export type EffectiveSlotRecord = ApiSchemas["EffectiveSlot"];

/** One cell's write. A null subject, teacher or room is a homeroom or assembly period. */
export interface SlotInput {
  academicSessionId: string;
  sectionId: string;
  dayOfWeek: number;
  periodId: string;
  subjectId: string | null;
  staffId: string | null;
  roomId: string | null;
  notes: string | null;
}

/** Every slot write answers with the section's conflicts in `meta` (§16). */
export interface SlotWriteResult {
  slot: TimetableSlotRecord | null;
  conflicts: TimetableConflict[];
}
