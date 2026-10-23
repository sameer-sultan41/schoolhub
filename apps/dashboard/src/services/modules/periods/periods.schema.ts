import { z } from "zod";
import { PERIOD_MIN_SEQUENCE, PERIOD_NAME_MAX } from "./periods-constant";

/**
 * The period form's schema. Field names match the API's, so a server error maps onto its
 * field with no re-mapping step.
 */

export type PeriodFormMessages = Record<"required" | "sequenceInvalid" | "endBeforeStart", string>;

export const PERIOD_FORM_MESSAGE_KEYS: PeriodFormMessages = {
  required: "required",
  sequenceInvalid: "sequenceInvalid",
  endBeforeStart: "endBeforeStart",
};

/** Zod can't reach next-intl, so the dialog passes its translated messages in. `HH:MM`
 * strings compare in time order, so `end_time > start_time` is a plain string comparison. */
export function createPeriodFormSchema(messages: PeriodFormMessages) {
  return z
    .object({
      /** `""` = every campus; sent as `null`. */
      campus_id: z.string(),
      name: z.string().trim().min(1, messages.required).max(PERIOD_NAME_MAX),
      sequence: z
        .number(messages.sequenceInvalid)
        .int(messages.sequenceInvalid)
        .min(PERIOD_MIN_SEQUENCE, messages.sequenceInvalid),
      start_time: z.string().min(1, messages.required),
      end_time: z.string().min(1, messages.required),
      is_break: z.boolean(),
      /** Empty = the tenant's working days; sent as `null`. */
      weekdays: z.array(z.number().int()),
    })
    .refine(
      (values) => !values.start_time || !values.end_time || values.end_time > values.start_time,
      {
        path: ["end_time"],
        error: messages.endBeforeStart,
      },
    );
}

export const periodFormSchema = createPeriodFormSchema(PERIOD_FORM_MESSAGE_KEYS);

export type PeriodFormValues = z.infer<typeof periodFormSchema>;
