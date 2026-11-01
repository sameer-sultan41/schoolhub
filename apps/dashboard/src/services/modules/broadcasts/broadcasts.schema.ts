import { z } from "zod";

import { BROADCAST_AUDIENCE_TYPES, BROADCAST_MESSAGE_MAX_LENGTH } from "./broadcasts-constant";

/** The messages a failed rule shows: already translated by the caller. */
export interface BroadcastMessages {
  campusRequired: string;
  classRequired: string;
  sectionRequired: string;
  messageRequired: string;
  messageTooLong: string;
}

/** How the sender's scope (`GET /broadcasts:scope`) shapes the form. */
export interface BroadcastSchemaOptions {
  /** A campus-restricted sender must name one of their campuses; an unrestricted one need not. */
  requireCampus: boolean;
}

/**
 * The broadcast form. A class audience needs at least one class and a section audience at
 * least one section, picked from one class (`section_class_id`, which the API never sees).
 */
export function createBroadcastSchema(
  messages: BroadcastMessages,
  { requireCampus }: BroadcastSchemaOptions,
) {
  return z
    .object({
      audience_type: z.enum(BROADCAST_AUDIENCE_TYPES),
      campus_id: z.string(),
      class_ids: z.array(z.string()),
      section_class_id: z.string(),
      section_ids: z.array(z.string()),
      message: z
        .string()
        .trim()
        .min(1, messages.messageRequired)
        .max(BROADCAST_MESSAGE_MAX_LENGTH, messages.messageTooLong),
    })
    .superRefine((values, ctx) => {
      if (requireCampus && values.campus_id === "") {
        ctx.addIssue({ code: "custom", path: ["campus_id"], message: messages.campusRequired });
      }
      if (values.audience_type === "class" && values.class_ids.length === 0) {
        ctx.addIssue({ code: "custom", path: ["class_ids"], message: messages.classRequired });
      }
      if (values.audience_type === "section" && values.section_ids.length === 0) {
        ctx.addIssue({ code: "custom", path: ["section_ids"], message: messages.sectionRequired });
      }
    });
}

export type BroadcastFormValues = z.infer<ReturnType<typeof createBroadcastSchema>>;
