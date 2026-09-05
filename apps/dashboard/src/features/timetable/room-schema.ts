import { z } from "zod";
import { ROOM_TYPES } from "@/features/timetable/timetable-constants";
import type { RoomTypeValue } from "@/features/timetable/timetable-types";

/** models.Room column lengths. */
export const ROOM_NAME_MAX_LENGTH = 80;
export const ROOM_CODE_MAX_LENGTH = 20;
export const ROOM_BUILDING_MAX_LENGTH = 80;
export const ROOM_FLOOR_MAX_LENGTH = 20;

/**
 * Mirrors models.Room's own column constraints. There is no §11 rule specific to
 * rooms beyond "capacity ≥ section size", and that one is deliberately a *soft*
 * conflict computed against live enrollment (conflicts._room_over_capacity) —
 * it belongs to the grid, not to this form, and a room is not invalid for being
 * small.
 *
 * The rule only the server can check is uniqueness of `code` within a campus
 * (`rooms_unique_code_per_campus`), which arrives as a 409 or a field error.
 *
 * NOTE: plain English messages rather than translation keys, as elsewhere in
 * this app.
 */
export const roomSchema = z.object({
  campus_id: z.string().min(1, "Pick the campus this room is on."),
  name: z
    .string()
    .min(1, "A room needs a name.")
    .max(ROOM_NAME_MAX_LENGTH, `A name may be at most ${ROOM_NAME_MAX_LENGTH} characters.`),
  code: z
    .string()
    .min(1, "A room needs a code.")
    .max(ROOM_CODE_MAX_LENGTH, `A code may be at most ${ROOM_CODE_MAX_LENGTH} characters.`),
  room_type: z.enum(ROOM_TYPES as [RoomTypeValue, ...RoomTypeValue[]]),
  // Nullable on the model: a hall with no fixed seating has no capacity, which
  // is different from a capacity of zero.
  capacity: z
    .string()
    .refine((value) => value === "" || (/^\d+$/.test(value) && Number(value) >= 1), {
      message: "Capacity must be a whole number of at least 1, or left blank.",
    }),
  building: z
    .string()
    .max(ROOM_BUILDING_MAX_LENGTH, `At most ${ROOM_BUILDING_MAX_LENGTH} characters.`),
  floor: z.string().max(ROOM_FLOOR_MAX_LENGTH, `At most ${ROOM_FLOOR_MAX_LENGTH} characters.`),
  is_active: z.boolean(),
});

export type RoomFormValues = z.infer<typeof roomSchema>;
