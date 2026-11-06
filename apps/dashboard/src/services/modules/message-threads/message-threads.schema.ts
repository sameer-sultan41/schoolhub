import { z } from "zod";

import {
  GROUP_MIN_PARTICIPANTS,
  INTERNAL_PARTICIPANTS,
  MESSAGE_BODY_MAX_LENGTH,
  NEW_THREAD_TYPES,
  THREAD_SUBJECT_MAX_LENGTH,
} from "./message-threads-constant";

/** The messages a failed rule shows: already translated by the caller. */
export interface NewThreadMessages {
  subjectRequired: string;
  subjectTooLong: string;
  bodyRequired: string;
  bodyTooLong: string;
  studentRequired: string;
  internalNeedsOne: string;
  groupNeedsTwo: string;
}

/**
 * The new-thread form. Who may be named depends on the type: a guardian thread is about a
 * student, an internal one has one colleague, a group two or more
 * (`docs/03-modules/communication.md`).
 */
export function createNewThreadSchema(messages: NewThreadMessages) {
  return z
    .object({
      thread_type: z.enum(NEW_THREAD_TYPES),
      subject: z
        .string()
        .trim()
        .min(1, messages.subjectRequired)
        .max(THREAD_SUBJECT_MAX_LENGTH, messages.subjectTooLong),
      body: z
        .string()
        .trim()
        .min(1, messages.bodyRequired)
        .max(MESSAGE_BODY_MAX_LENGTH, messages.bodyTooLong),
      student: z.object({ id: z.string(), name: z.string() }).nullable(),
      participants: z.array(
        z.object({ user_id: z.string(), name: z.string(), role: z.string().nullable() }),
      ),
    })
    .superRefine((values, ctx) => {
      if (values.thread_type === "guardian_school" && !values.student) {
        ctx.addIssue({ code: "custom", path: ["student"], message: messages.studentRequired });
      }
      if (
        values.thread_type === "internal" &&
        values.participants.length !== INTERNAL_PARTICIPANTS
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["participants"],
          message: messages.internalNeedsOne,
        });
      }
      if (values.thread_type === "group" && values.participants.length < GROUP_MIN_PARTICIPANTS) {
        ctx.addIssue({ code: "custom", path: ["participants"], message: messages.groupNeedsTwo });
      }
    });
}

export type NewThreadFormValues = z.infer<ReturnType<typeof createNewThreadSchema>>;
