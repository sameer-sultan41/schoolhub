import { z } from "zod";
import { Regex } from "@/lib/regex";

/**
 * The teacher-allocations module's Zod schemas. Field names are snake_case, matching the API's
 * own, so `error.fieldErrors()` keys map onto them with no re-mapping step.
 */

/** The validation messages an allocation form can show. */
export type AllocationFormMessages = Record<"required" | "weeklyPeriodsInvalid", string>;

/** The messages as bare keys, for the module-level schema below. */
export const ALLOCATION_FORM_MESSAGE_KEYS: AllocationFormMessages = {
  required: "required",
  weeklyPeriodsInvalid: "weeklyPeriodsInvalid",
};

/**
 * The allocate form's schema, with `messages` as the text a failed rule shows. Zod can't reach
 * next-intl, so the dialog passes its translated messages in.
 *
 * `class_id` only drives the section and subject pickers: it is never sent. `weekly_periods`
 * is the input's own text, `""` meaning "no override" (sent as `null`), so a plain
 * `type="number"` input needs no number coercion.
 */
export function createAllocationFormSchema(messages: AllocationFormMessages) {
  return z.object({
    class_id: z.string().regex(Regex.UUID, messages.required),
    section_id: z.string().regex(Regex.UUID, messages.required),
    subject_id: z.string().regex(Regex.UUID, messages.required),
    staff_id: z.string().regex(Regex.UUID, messages.required),
    is_primary: z.boolean(),
    weekly_periods: z
      .string()
      .refine(
        (value) => value === "" || Regex.POSITIVE_INTEGER.test(value),
        messages.weeklyPeriodsInvalid,
      ),
    /** `""` = no start date; sent as `null`. */
    effective_from: z.string(),
  });
}

/** The edit form's schema: only what an allocation may change after it is made. */
export function createAllocationEditFormSchema(messages: AllocationFormMessages) {
  return createAllocationFormSchema(messages).pick({
    is_primary: true,
    weekly_periods: true,
    effective_from: true,
  });
}

export const allocationFormSchema = createAllocationFormSchema(ALLOCATION_FORM_MESSAGE_KEYS);
export const allocationEditFormSchema = createAllocationEditFormSchema(
  ALLOCATION_FORM_MESSAGE_KEYS,
);

export type AllocationFormValues = z.infer<typeof allocationFormSchema>;
export type AllocationEditFormValues = z.infer<typeof allocationEditFormSchema>;
