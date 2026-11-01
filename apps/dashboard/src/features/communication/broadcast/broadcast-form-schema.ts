import { z } from "zod";

import {
  BROADCAST_AUDIENCE_TYPES,
  BROADCAST_MESSAGE_MAX_LENGTH,
} from "@/services/modules/broadcasts/broadcasts-constant";
import type { BroadcastRequest } from "@/services/modules/broadcasts/broadcasts-type";

/** The messages a failed rule shows: already translated by the caller. */
export interface BroadcastMessages {
  classRequired: string;
  sectionRequired: string;
  messageRequired: string;
  messageTooLong: string;
}

/**
 * The broadcast form. A class audience needs at least one class and a section audience at
 * least one section, picked from one class (`section_class_id`, which the API never sees).
 */
export function createBroadcastSchema(messages: BroadcastMessages) {
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
      if (values.audience_type === "class" && values.class_ids.length === 0) {
        ctx.addIssue({ code: "custom", path: ["class_ids"], message: messages.classRequired });
      }
      if (values.audience_type === "section" && values.section_ids.length === 0) {
        ctx.addIssue({ code: "custom", path: ["section_ids"], message: messages.sectionRequired });
      }
    });
}

export type BroadcastFormValues = z.infer<ReturnType<typeof createBroadcastSchema>>;

export const BROADCAST_DEFAULTS: BroadcastFormValues = {
  audience_type: "all",
  campus_id: "",
  class_ids: [],
  section_class_id: "",
  section_ids: [],
  message: "",
};

/** The request body: only the filter the audience type reads, and the campus when one is set. */
export function buildBroadcastRequest(values: BroadcastFormValues): BroadcastRequest {
  const request: BroadcastRequest = {
    audience_type: values.audience_type,
    message: values.message.trim(),
  };
  if (values.audience_type === "class") request.audience_filter = { class_ids: values.class_ids };
  if (values.audience_type === "section") {
    request.audience_filter = { section_ids: values.section_ids };
  }
  if (values.campus_id !== "") request.campus_id = values.campus_id;
  return request;
}
