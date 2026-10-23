import { z } from "zod";
import { Regex } from "@/lib/regex";
import {
  ROOM_BUILDING_MAX,
  ROOM_CODE_MAX,
  ROOM_FLOOR_MAX,
  ROOM_NAME_MAX,
  ROOM_TYPES,
} from "./rooms-constant";
import type { RoomType } from "./rooms-type";

/** The room form's schema, with the API's own field names. */

export type RoomFormMessages = Record<"required" | "capacityInvalid", string>;

export const ROOM_FORM_MESSAGE_KEYS: RoomFormMessages = {
  required: "required",
  capacityInvalid: "capacityInvalid",
};

/**
 * `capacity` is a string, not a number: blank is a real answer ("no fixed seating"), and a
 * number input that is cleared reads as NaN, which a `z.number()` can't tell apart from a typo.
 */
export function createRoomFormSchema(messages: RoomFormMessages) {
  return z.object({
    campus_id: z.string().regex(Regex.UUID, messages.required),
    name: z.string().trim().min(1, messages.required).max(ROOM_NAME_MAX),
    code: z.string().trim().min(1, messages.required).max(ROOM_CODE_MAX),
    room_type: z.enum(ROOM_TYPES as [RoomType, ...RoomType[]]),
    // Blank, or a whole number of at least one seat (`ROOM_MIN_CAPACITY`).
    capacity: z
      .string()
      .refine(
        (value) => value.trim() === "" || Regex.POSITIVE_INTEGER.test(value.trim()),
        messages.capacityInvalid,
      ),
    building: z.string().max(ROOM_BUILDING_MAX),
    floor: z.string().max(ROOM_FLOOR_MAX),
    is_active: z.boolean(),
  });
}

export const roomFormSchema = createRoomFormSchema(ROOM_FORM_MESSAGE_KEYS);

export type RoomFormValues = z.infer<typeof roomFormSchema>;
