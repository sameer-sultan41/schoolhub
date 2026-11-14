import { z } from "zod";

import { FEE_STRUCTURE_NAME_MAX } from "./fee-structures-constant";

/** The fee-structure form's schema, with the API's own field names (`academic_session`,
 * `school_class`, `campus`). */

export type FeeStructureFormMessages = Record<"required", string>;
export const FEE_STRUCTURE_FORM_MESSAGE_KEYS: FeeStructureFormMessages = { required: "required" };

/** `school_class` and `campus` are `""` for "every class" and "every campus". */
export function createFeeStructureFormSchema(messages: FeeStructureFormMessages) {
  return z.object({
    name: z.string().trim().min(1, messages.required).max(FEE_STRUCTURE_NAME_MAX),
    academic_session: z.string().min(1, messages.required),
    school_class: z.string(),
    campus: z.string(),
  });
}

export const feeStructureFormSchema = createFeeStructureFormSchema(FEE_STRUCTURE_FORM_MESSAGE_KEYS);
export type FeeStructureFormValues = z.infer<typeof feeStructureFormSchema>;
