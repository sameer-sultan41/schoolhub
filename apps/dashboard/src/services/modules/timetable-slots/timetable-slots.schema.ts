import { z } from "zod";
import { SLOT_NOTES_MAX } from "./timetable-slots-constant";

/**
 * The grid cell form. Every pick is optional: a homeroom or assembly period has no subject or
 * teacher, and a grid mid-build may be wrong (the conflict engine says so, not the form).
 * `""` means none for each id.
 */
export const slotFormSchema = z.object({
  subject_id: z.string(),
  staff_id: z.string(),
  room_id: z.string(),
  notes: z.string().max(SLOT_NOTES_MAX),
});

export type SlotFormValues = z.infer<typeof slotFormSchema>;
