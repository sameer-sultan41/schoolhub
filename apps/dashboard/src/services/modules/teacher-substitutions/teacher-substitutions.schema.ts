import { z } from "zod";
import { Regex } from "@/lib/regex";
import { SUBSTITUTION_REASON_MAX } from "./teacher-substitutions-constant";

/** The propose-cover form: a date, the absent teacher, one of their classes that day, the
 * teacher covering it, and optionally a room move and a reason. */

export type ProposeFormMessages = Record<"required", string>;

export function createProposeFormSchema(messages: ProposeFormMessages) {
  return z.object({
    date: z.string().regex(Regex.ISO_DATE, messages.required),
    absent_staff_id: z.string().regex(Regex.UUID, messages.required),
    timetable_slot_id: z.string().regex(Regex.UUID, messages.required),
    substitute_staff_id: z.string().regex(Regex.UUID, messages.required),
    /** `""` keeps the timetabled room. */
    room_id: z.string(),
    reason: z.string().max(SUBSTITUTION_REASON_MAX),
  });
}

export const proposeFormSchema = createProposeFormSchema({ required: "required" });

export type ProposeFormValues = z.infer<typeof proposeFormSchema>;
