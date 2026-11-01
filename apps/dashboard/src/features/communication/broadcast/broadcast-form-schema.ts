import {
  createBroadcastSchema,
  type BroadcastFormValues,
} from "@/services/modules/broadcasts/broadcasts.schema";
import type { BroadcastRequest } from "@/services/modules/broadcasts/broadcasts-type";

export { createBroadcastSchema };
export type { BroadcastFormValues };

export const BROADCAST_DEFAULTS: BroadcastFormValues = {
  audience_type: "all",
  campus_id: "",
  class_ids: [],
  section_class_id: "",
  section_ids: [],
  message: "",
};

/** Whether `key` names a broadcast form field: narrows a Zod issue's path segment. */
export function isBroadcastField(key: PropertyKey | undefined): key is keyof BroadcastFormValues {
  return typeof key === "string" && key in BROADCAST_DEFAULTS;
}

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
