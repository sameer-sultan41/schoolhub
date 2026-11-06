import { z } from "zod";

import { FEE_HEAD_CATEGORIES, FEE_HEAD_CODE_MAX, FEE_HEAD_NAME_MAX } from "./fee-heads-constant";
import type { FeeHeadCategory } from "./fee-heads-type";

/** The fee-head form's schema, with the API's own field names (`ledger_account`, `is_refundable`). */

const categoryEnum = z.enum(FEE_HEAD_CATEGORIES as [FeeHeadCategory, ...FeeHeadCategory[]]);

export type FeeHeadFormMessages = Record<"required", string>;
export const FEE_HEAD_FORM_MESSAGE_KEYS: FeeHeadFormMessages = { required: "required" };

export function createFeeHeadFormSchema(messages: FeeHeadFormMessages) {
  return z.object({
    name: z.string().trim().min(1, messages.required).max(FEE_HEAD_NAME_MAX),
    code: z.string().trim().min(1, messages.required).max(FEE_HEAD_CODE_MAX),
    category: categoryEnum,
    ledger_account: z.string().min(1, messages.required),
    is_refundable: z.boolean(),
    is_active: z.boolean(),
  });
}

export const feeHeadFormSchema = createFeeHeadFormSchema(FEE_HEAD_FORM_MESSAGE_KEYS);
export type FeeHeadFormValues = z.infer<typeof feeHeadFormSchema>;
