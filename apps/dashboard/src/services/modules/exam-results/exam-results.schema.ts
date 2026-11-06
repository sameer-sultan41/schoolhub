import { z } from "zod";

/** The reason form's schema (withhold, send back), with the API's own field name. The server
 * requires the reason too, each action with its own maximum length. */

export type ReasonFormMessages = Record<"required" | "tooLong", string>;

export function createReasonFormSchema(maxLength: number, messages: ReasonFormMessages) {
  return z.object({
    reason: z.string().trim().min(1, messages.required).max(maxLength, messages.tooLong),
  });
}

export type ReasonFormValues = z.infer<ReturnType<typeof createReasonFormSchema>>;
