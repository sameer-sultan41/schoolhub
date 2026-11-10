import { z } from "zod";

import {
  LEAVE_DAY_PARTS,
  LEAVE_NOTE_MAX_LENGTH,
  LEAVE_REASON_MAX_LENGTH,
} from "./leave-requests-constant";

/** The approve / reject dialog: an optional note, `""` for none. */
export function createLeaveDecisionSchema(messages: { noteTooLong: string }) {
  return z.object({
    note: z.string().max(LEAVE_NOTE_MAX_LENGTH, messages.noteTooLong),
  });
}

export type LeaveDecisionFormValues = z.infer<ReturnType<typeof createLeaveDecisionSchema>>;

/**
 * A guardian's new request. Mirrors the server (§11): a type, dates in order, a half day only
 * on one date, a reason, and an attachment when the type asks for one (`attachmentRequired` is
 * decided by the chosen type, so the schema is built per attempt).
 */
export function createNewLeaveSchema(messages: {
  typeRequired: string;
  startRequired: string;
  endRequired: string;
  endBeforeStart: string;
  halfDaySingleDay: string;
  reasonRequired: string;
  reasonTooLong: string;
  attachmentRequired: string;
  requiresAttachment: (leaveTypeId: string) => boolean;
}) {
  return z
    .object({
      leave_type_id: z.string().min(1, messages.typeRequired),
      start_date: z.string().min(1, messages.startRequired),
      end_date: z.string().min(1, messages.endRequired),
      day_part: z.enum(LEAVE_DAY_PARTS),
      reason: z
        .string()
        .trim()
        .min(1, messages.reasonRequired)
        .max(LEAVE_REASON_MAX_LENGTH, messages.reasonTooLong),
      attachment_file_id: z.string(),
    })
    .superRefine((values, ctx) => {
      if (values.start_date && values.end_date && values.end_date < values.start_date) {
        ctx.addIssue({ code: "custom", path: ["end_date"], message: messages.endBeforeStart });
      }
      if (
        values.day_part !== "full" &&
        values.start_date &&
        values.end_date &&
        values.start_date !== values.end_date
      ) {
        ctx.addIssue({ code: "custom", path: ["day_part"], message: messages.halfDaySingleDay });
      }
      if (
        values.leave_type_id &&
        messages.requiresAttachment(values.leave_type_id) &&
        !values.attachment_file_id
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["attachment_file_id"],
          message: messages.attachmentRequired,
        });
      }
    });
}

export type NewLeaveFormValues = z.infer<ReturnType<typeof createNewLeaveSchema>>;
