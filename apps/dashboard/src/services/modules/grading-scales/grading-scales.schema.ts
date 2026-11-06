import { z } from "zod";
import { Regex } from "@/lib/regex";
import {
  BAND_LABEL_MAX,
  BAND_REMARK_MAX,
  DECIMAL_PATTERN,
  GPA_SCALE_TYPES,
  SCALE_DESCRIPTION_MAX,
  SCALE_NAME_MAX,
  SCALE_TYPES,
} from "./grading-scales-constant";
import type { GradingScaleType } from "./grading-scales-type";

/** The scale and band forms' schemas, with the API's own field names. */

export type ScaleFormMessages = Record<"required" | "decimalInvalid", string>;
export const SCALE_FORM_MESSAGE_KEYS: ScaleFormMessages = {
  required: "required",
  decimalInvalid: "decimalInvalid",
};

/** Blank, or a decimal the column can store. */
function optionalDecimal(message: string) {
  return z
    .string()
    .refine((value) => value.trim() === "" || DECIMAL_PATTERN.test(value.trim()), message);
}

/** `gpa_max` is a string, not a number: blank is a real answer for a percentage or letter scale. */
export function createScaleFormSchema(messages: ScaleFormMessages) {
  return z
    .object({
      name: z.string().trim().min(1, messages.required).max(SCALE_NAME_MAX),
      scale_type: z.enum(SCALE_TYPES as [GradingScaleType, ...GradingScaleType[]]),
      gpa_max: optionalDecimal(messages.decimalInvalid),
      description: z.string().max(SCALE_DESCRIPTION_MAX),
    })
    .superRefine((values, context) => {
      if (GPA_SCALE_TYPES.includes(values.scale_type) && values.gpa_max.trim() === "") {
        context.addIssue({ code: "custom", path: ["gpa_max"], message: messages.required });
      }
    });
}

export const scaleFormSchema = createScaleFormSchema(SCALE_FORM_MESSAGE_KEYS);

export type ScaleFormValues = z.infer<typeof scaleFormSchema>;

export type BandFormMessages = Record<"required" | "decimalInvalid" | "orderInvalid", string>;
export const BAND_FORM_MESSAGE_KEYS: BandFormMessages = {
  required: "required",
  decimalInvalid: "decimalInvalid",
  orderInvalid: "orderInvalid",
};

/** Percentages and the order are strings, so a cleared input is blank rather than NaN. The
 * lower bound below the upper one is the server's rule (`GradeBandSerializer.validate`) and
 * lands under `max_percent` from there. */
export function createBandFormSchema(messages: BandFormMessages) {
  return z.object({
    label: z.string().trim().min(1, messages.required).max(BAND_LABEL_MAX),
    min_percent: z.string().trim().regex(DECIMAL_PATTERN, messages.decimalInvalid),
    max_percent: z.string().trim().regex(DECIMAL_PATTERN, messages.decimalInvalid),
    grade_point: optionalDecimal(messages.decimalInvalid),
    is_passing: z.boolean(),
    remark: z.string().max(BAND_REMARK_MAX),
    sort_order: z
      .string()
      .refine(
        (value) => value.trim() === "0" || Regex.POSITIVE_INTEGER.test(value.trim()),
        messages.orderInvalid,
      ),
  });
}

export const bandFormSchema = createBandFormSchema(BAND_FORM_MESSAGE_KEYS);

export type BandFormValues = z.infer<typeof bandFormSchema>;
