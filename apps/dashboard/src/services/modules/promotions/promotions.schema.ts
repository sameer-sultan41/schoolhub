import { z } from "zod";
import { Regex } from "@/lib/regex";
import { OVERRIDE_REASON_MAX, PROMOTION_DECISION, REMARKS_MAX } from "./promotions-constant";

/**
 * The promotions module's Zod schemas. Field names are snake_case, matching the API's own, so
 * `error.fieldErrors()` keys map onto them with no re-mapping step.
 */

/** The create-batch form's schema; `required` is the text an unpicked select shows. */
export function createPromotionBatchFormSchema(required: string) {
  return z.object({
    from_academic_session_id: z.string().regex(Regex.UUID, required),
    to_academic_session_id: z.string().regex(Regex.UUID, required),
    class_id: z.string().regex(Regex.UUID, required),
  });
}

export type PromotionBatchFormValues = z.infer<ReturnType<typeof createPromotionBatchFormSchema>>;

/** The text a failed rule of the decision editor shows. */
export interface PromotionDecisionFormMessages {
  required: string;
  overrideReasonTooLong: string;
  remarksTooLong: string;
}

/**
 * The decision editor's schema. Ids are `""` for "none" (the dialog sends `null`). Every
 * decision but graduating needs a target class (`PromotionDecisionSerializer.validate`); the
 * target section is optional here, because only executing the batch needs it. The override
 * reason is not required here either: the server asks for it where a row deviates from its
 * proposal, when the batch is submitted, so a reviewer can work through a draft in any order.
 */
export function createPromotionDecisionFormSchema(messages: PromotionDecisionFormMessages) {
  return z
    .object({
      decision: z.enum(PROMOTION_DECISION),
      to_class_id: z.string(),
      to_section_id: z.string(),
      override_reason: z.string().max(OVERRIDE_REASON_MAX, messages.overrideReasonTooLong),
      remarks: z.string().max(REMARKS_MAX, messages.remarksTooLong),
    })
    .refine(
      (values) => values.decision === PROMOTION_DECISION.graduated || values.to_class_id !== "",
      { path: ["to_class_id"], error: messages.required },
    );
}

export type PromotionDecisionFormValues = z.infer<
  ReturnType<typeof createPromotionDecisionFormSchema>
>;
