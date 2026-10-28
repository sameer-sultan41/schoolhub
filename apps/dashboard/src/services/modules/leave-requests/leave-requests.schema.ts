import { z } from "zod";

import { LEAVE_NOTE_MAX_LENGTH } from "./leave-requests-constant";

/** The approve / reject dialog: an optional note, `""` for none. */
export function createLeaveDecisionSchema(messages: { noteTooLong: string }) {
  return z.object({
    note: z.string().max(LEAVE_NOTE_MAX_LENGTH, messages.noteTooLong),
  });
}

export type LeaveDecisionFormValues = z.infer<ReturnType<typeof createLeaveDecisionSchema>>;
