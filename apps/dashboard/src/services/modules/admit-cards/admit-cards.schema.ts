import { z } from "zod";

import { REVOKE_REASON_MAX_LENGTH } from "./admit-cards-constant";

/** The revoke form's schema, with the API's own field name. The server trims and requires the
 * reason too (a CHECK constraint backs it). */

export type RevokeFormMessages = Record<"required" | "tooLong", string>;
export const REVOKE_FORM_MESSAGE_KEYS: RevokeFormMessages = {
  required: "required",
  tooLong: "tooLong",
};

export function createRevokeFormSchema(messages: RevokeFormMessages) {
  return z.object({
    reason: z
      .string()
      .trim()
      .min(1, messages.required)
      .max(REVOKE_REASON_MAX_LENGTH, messages.tooLong),
  });
}

export const revokeFormSchema = createRevokeFormSchema(REVOKE_FORM_MESSAGE_KEYS);

export type RevokeFormValues = z.infer<typeof revokeFormSchema>;
