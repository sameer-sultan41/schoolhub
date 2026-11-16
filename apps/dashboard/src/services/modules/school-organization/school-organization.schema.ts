import { z } from "zod";

import { Regex } from "@/lib/regex";
import {
  CAMPUS_CODE_MAX,
  CAMPUS_EMAIL_MAX,
  CAMPUS_NAME_MAX,
  CAMPUS_PHONE_MAX,
  CAMPUS_TIMEZONE_MAX,
  DEPARTMENT_CODE_MAX,
  DEPARTMENT_DESCRIPTION_MAX,
  DEPARTMENT_NAME_MAX,
  DEPARTMENT_TYPES,
  HOLIDAY_NAME_MAX,
  HOUSE_CODE_MAX,
  HOUSE_COLOR_MAX,
  HOUSE_MOTTO_MAX,
  HOUSE_NAME_MAX,
} from "./school-organization-constant";
import type { DepartmentType } from "./school-organization-type";

/**
 * The School module's structure forms, with the API's own field names, so a server error's
 * field needs no mapping. An optional text field is a string, blank meaning "none".
 */

export type StructureFormMessages = Record<
  "required" | "emailInvalid" | "colorInvalid" | "endBeforeStart",
  string
>;

export const STRUCTURE_FORM_MESSAGE_KEYS: StructureFormMessages = {
  required: "required",
  emailInvalid: "emailInvalid",
  colorInvalid: "colorInvalid",
  endBeforeStart: "endBeforeStart",
};

const requiredText = (max: number, messages: StructureFormMessages) =>
  z.string().trim().min(1, messages.required).max(max);

export function createCampusFormSchema(messages: StructureFormMessages) {
  return z.object({
    name: requiredText(CAMPUS_NAME_MAX, messages),
    code: requiredText(CAMPUS_CODE_MAX, messages),
    phone: z.string().trim().max(CAMPUS_PHONE_MAX),
    email: z
      .string()
      .trim()
      .max(CAMPUS_EMAIL_MAX)
      .refine((value) => value === "" || z.email().safeParse(value).success, messages.emailInvalid),
    timezone: z.string().trim().max(CAMPUS_TIMEZONE_MAX),
    is_primary: z.boolean(),
    is_active: z.boolean(),
  });
}

export function createDepartmentFormSchema(messages: StructureFormMessages) {
  return z.object({
    name: requiredText(DEPARTMENT_NAME_MAX, messages),
    code: requiredText(DEPARTMENT_CODE_MAX, messages),
    department_type: z.enum(DEPARTMENT_TYPES as [DepartmentType, ...DepartmentType[]]),
    /** A campus id, or blank for a department that spans every campus. */
    campus_id: z.string(),
    description: z.string().trim().max(DEPARTMENT_DESCRIPTION_MAX),
    is_active: z.boolean(),
  });
}

export function createHouseFormSchema(messages: StructureFormMessages) {
  return z.object({
    name: requiredText(HOUSE_NAME_MAX, messages),
    code: z.string().trim().max(HOUSE_CODE_MAX),
    color: z
      .string()
      .trim()
      .max(HOUSE_COLOR_MAX)
      .refine((value) => value === "" || Regex.HEX_COLOR.test(value), messages.colorInvalid),
    motto: z.string().trim().max(HOUSE_MOTTO_MAX),
    is_active: z.boolean(),
  });
}

export function createHolidayFormSchema(messages: StructureFormMessages) {
  return z
    .object({
      name: requiredText(HOLIDAY_NAME_MAX, messages),
      start_date: z.string().regex(Regex.ISO_DATE, messages.required),
      /** Blank for a one-day holiday. */
      end_date: z.string(),
      /** A campus id, or blank for every campus. */
      campus_id: z.string(),
    })
    .refine((values) => values.end_date === "" || values.end_date >= values.start_date, {
      message: messages.endBeforeStart,
      path: ["end_date"],
    });
}

export const campusFormSchema = createCampusFormSchema(STRUCTURE_FORM_MESSAGE_KEYS);
export const departmentFormSchema = createDepartmentFormSchema(STRUCTURE_FORM_MESSAGE_KEYS);
export const houseFormSchema = createHouseFormSchema(STRUCTURE_FORM_MESSAGE_KEYS);
export const holidayFormSchema = createHolidayFormSchema(STRUCTURE_FORM_MESSAGE_KEYS);

export type CampusFormValues = z.infer<typeof campusFormSchema>;
export type DepartmentFormValues = z.infer<typeof departmentFormSchema>;
export type HouseFormValues = z.infer<typeof houseFormSchema>;
export type HolidayFormValues = z.infer<typeof holidayFormSchema>;
