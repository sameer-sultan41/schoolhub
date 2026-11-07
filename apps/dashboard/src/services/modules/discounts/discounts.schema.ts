import { z } from "zod";

import { DISCOUNT_NAME_MAX, DISCOUNT_REASON_MAX, DISCOUNT_TYPES } from "./discounts-constant";
import type { DiscountType } from "./discounts-type";

/** The discount forms' schemas, with the API's own field names. */

export type DiscountFormMessages = Record<"required" | "invalidValue" | "endBeforeStart", string>;
export const DISCOUNT_FORM_MESSAGE_KEYS: DiscountFormMessages = {
  required: "required",
  invalidValue: "invalidValue",
  endBeforeStart: "endBeforeStart",
};

const PERCENT_MAX = 100;
const typeEnum = z.enum(DISCOUNT_TYPES as [DiscountType, ...DiscountType[]]);

/** The value is kept as the typed text and sent as is: the server owns the decimal. It must be positive, and a percent at most 100. */
export function createDiscountFormSchema(messages: DiscountFormMessages) {
  return z
    .object({
      student: z.string().min(1, messages.required),
      academic_session: z.string().min(1, messages.required),
      name: z.string().trim().min(1, messages.required).max(DISCOUNT_NAME_MAX),
      discount_type: typeEnum,
      value: z.string().trim().min(1, messages.required),
      fee_head: z.string(),
      valid_from: z.string(),
      valid_to: z.string(),
      reason: z.string().trim().max(DISCOUNT_REASON_MAX),
    })
    .superRefine((values, context) => {
      const value = Number(values.value);
      const tooBig = values.discount_type === "percent" && value > PERCENT_MAX;
      if (values.value.trim() !== "" && (Number.isNaN(value) || value <= 0 || tooBig)) {
        context.addIssue({ code: "custom", path: ["value"], message: messages.invalidValue });
      }
      if (values.valid_from && values.valid_to && values.valid_to < values.valid_from) {
        context.addIssue({ code: "custom", path: ["valid_to"], message: messages.endBeforeStart });
      }
    });
}
export const discountFormSchema = createDiscountFormSchema(DISCOUNT_FORM_MESSAGE_KEYS);
export type DiscountFormValues = z.infer<typeof discountFormSchema>;

export function createRevokeDiscountFormSchema(messages: Pick<DiscountFormMessages, "required">) {
  return z.object({
    reason: z.string().trim().min(1, messages.required).max(DISCOUNT_REASON_MAX),
  });
}
export const revokeDiscountFormSchema = createRevokeDiscountFormSchema({ required: "required" });
export type RevokeDiscountFormValues = z.infer<typeof revokeDiscountFormSchema>;
