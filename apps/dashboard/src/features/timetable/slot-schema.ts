import { z } from "zod";

/** models.TimetableSlot.notes is `CharField(max_length=200)`. */
export const SLOT_NOTES_MAX_LENGTH = 200;

/**
 * Mirrors the API's slot validations (timetable.md §11) so the user gets instant
 * feedback, while the API remains the authority.
 *
 * Only the cell's *contents* are here. The cell's coordinates — session, section,
 * weekday, period — are fixed by the grid square that was clicked and travel as
 * props, so they are not form state and cannot be wrong.
 *
 * The rules only the server can check are deliberately absent: the teacher must
 * be active teaching staff, the period must not be a break or belong to another
 * campus, and nothing may be double-booked. Note that most of those are
 * *conflicts* rather than refusals — `conflicts.py`'s header is explicit that a
 * draft is allowed to hold them while it is being built, so the save succeeds and
 * the findings come back in `meta.conflicts`. Only the staff-is-active rule is a
 * hard refusal, and it reaches the form through `ApiError.fieldErrors()`.
 *
 * NOTE: like academics' allocation-schema.ts, these messages are plain English
 * rather than translation keys — this codebase has no established pattern yet for
 * translating client-side Zod/RHF messages.
 */
export const slotSchema = z.object({
  // Every one of these is nullable on the model: a homeroom or assembly slot has
  // no subject and no teacher, and a slot held outside a room has no room.
  subject_id: z.string(),
  staff_id: z.string(),
  room_id: z.string(),
  notes: z
    .string()
    .max(SLOT_NOTES_MAX_LENGTH, `A note may be at most ${SLOT_NOTES_MAX_LENGTH} characters.`),
});

export type SlotFormValues = z.infer<typeof slotSchema>;
