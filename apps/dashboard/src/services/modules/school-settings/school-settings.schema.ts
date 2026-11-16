import { z } from "zod";

import { SUPPORTED_LOCALES } from "@/lib/env";
import { Regex } from "@/lib/regex";
import {
  SCHOOL_CURRENCY_LENGTH,
  SCHOOL_NAME_MAX,
  SCHOOL_TIMEZONE_MAX,
} from "./school-settings-constant";

/** The profile form's schema, with the API's own field names (the colour is flattened out of
 * `branding`). */

export type SchoolProfileMessages = Record<"required" | "colorInvalid" | "currencyInvalid", string>;

export const SCHOOL_PROFILE_MESSAGE_KEYS: SchoolProfileMessages = {
  required: "required",
  colorInvalid: "colorInvalid",
  currencyInvalid: "currencyInvalid",
};

export function createSchoolProfileSchema(messages: SchoolProfileMessages) {
  return z.object({
    name: z.string().trim().min(1, messages.required).max(SCHOOL_NAME_MAX),
    /** A file id, or blank for no logo. */
    logo_file_id: z.string(),
    /** Blank keeps the theme's own colour. */
    primary_color: z
      .string()
      .trim()
      .refine((value) => value === "" || Regex.HEX_COLOR.test(value), messages.colorInvalid),
    timezone: z.string().trim().min(1, messages.required).max(SCHOOL_TIMEZONE_MAX),
    locale: z.enum(SUPPORTED_LOCALES),
    currency: z
      .string()
      .trim()
      .length(SCHOOL_CURRENCY_LENGTH, messages.currencyInvalid)
      .regex(Regex.LETTERS, messages.currencyInvalid),
  });
}

export const schoolProfileSchema = createSchoolProfileSchema(SCHOOL_PROFILE_MESSAGE_KEYS);

export type SchoolProfileFormValues = z.infer<typeof schoolProfileSchema>;
