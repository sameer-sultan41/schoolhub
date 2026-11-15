import { z } from "zod";

import { Regex } from "@/lib/regex";
import {
  CAMPUS_CODE_MAX,
  CLASS_CODE_MAX,
  CLASS_NAME_MAX,
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
  SECTION_NAME_MAX,
  SESSION_NAME_MAX,
  SUBJECT_CODE_MAX,
  SUBJECT_DESCRIPTION_MAX,
  SUBJECT_NAME_MAX,
  SUBJECT_TYPES,
  TERM_NAME_MAX,
} from "./school-organization-constant";
import type { DepartmentType, SubjectType } from "./school-organization-type";

/**
 * The School module's structure forms, with the API's own field names, so a server error's
 * field needs no mapping. An optional text field is a string, blank meaning "none".
 */

export type StructureFormMessages = Record<
  | "required"
  | "emailInvalid"
  | "colorInvalid"
  | "endBeforeStart"
  | "endNotAfterStart"
  | "wholeNumberInvalid",
  string
>;

export const STRUCTURE_FORM_MESSAGE_KEYS: StructureFormMessages = {
  required: "required",
  emailInvalid: "emailInvalid",
  colorInvalid: "colorInvalid",
  endBeforeStart: "endBeforeStart",
  endNotAfterStart: "endNotAfterStart",
  wholeNumberInvalid: "wholeNumberInvalid",
};

const requiredText = (max: number, messages: StructureFormMessages) =>
  z.string().trim().min(1, messages.required).max(max);

/** A whole number from 1, as an input holds it (a string), sent as a number. */
const wholeNumber = (messages: StructureFormMessages) =>
  z.string().trim().regex(Regex.POSITIVE_INTEGER, messages.wholeNumberInvalid);

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

/** A session's or a term's window: both days set, the last after the first (the models'
 * `end_date > start_date` check). */
const dateWindow = (messages: StructureFormMessages) => ({
  start_date: z.string().regex(Regex.ISO_DATE, messages.required),
  end_date: z.string().regex(Regex.ISO_DATE, messages.required),
});

function endsAfterStart(values: { start_date: string; end_date: string }): boolean {
  return values.end_date > values.start_date;
}

/** A session's create, edit and clone form: the same three fields. */
export function createSessionFormSchema(messages: StructureFormMessages) {
  return z
    .object({ name: requiredText(SESSION_NAME_MAX, messages), ...dateWindow(messages) })
    .refine(endsAfterStart, { message: messages.endNotAfterStart, path: ["end_date"] });
}

/** `sequence` is a string, as an input holds it, sent as a number: 1-based order. */
export function createTermFormSchema(messages: StructureFormMessages) {
  return z
    .object({
      name: requiredText(TERM_NAME_MAX, messages),
      sequence: wholeNumber(messages),
      ...dateWindow(messages),
    })
    .refine(endsAfterStart, { message: messages.endNotAfterStart, path: ["end_date"] });
}

/** `level` orders the promotion ladder: a whole number from 1, unique in the school. */
export function createClassFormSchema(messages: StructureFormMessages) {
  return z.object({
    name: requiredText(CLASS_NAME_MAX, messages),
    code: z.string().trim().max(CLASS_CODE_MAX),
    level: wholeNumber(messages),
    is_active: z.boolean(),
  });
}

/** A section sits in one class at one campus; a blank capacity is unlimited. */
export function createSectionFormSchema(messages: StructureFormMessages) {
  return z.object({
    class_id: z.string().min(1, messages.required),
    campus_id: z.string().min(1, messages.required),
    name: requiredText(SECTION_NAME_MAX, messages),
    capacity: z.union([z.literal(""), wholeNumber(messages)]),
    is_active: z.boolean(),
  });
}

export function createSubjectFormSchema(messages: StructureFormMessages) {
  return z.object({
    name: requiredText(SUBJECT_NAME_MAX, messages),
    code: requiredText(SUBJECT_CODE_MAX, messages),
    subject_type: z.enum(SUBJECT_TYPES as [SubjectType, ...SubjectType[]]),
    /** A department id, or blank for none. */
    department_id: z.string(),
    description: z.string().trim().max(SUBJECT_DESCRIPTION_MAX),
    is_active: z.boolean(),
  });
}

export const campusFormSchema = createCampusFormSchema(STRUCTURE_FORM_MESSAGE_KEYS);
export const departmentFormSchema = createDepartmentFormSchema(STRUCTURE_FORM_MESSAGE_KEYS);
export const houseFormSchema = createHouseFormSchema(STRUCTURE_FORM_MESSAGE_KEYS);
export const holidayFormSchema = createHolidayFormSchema(STRUCTURE_FORM_MESSAGE_KEYS);
export const sessionFormSchema = createSessionFormSchema(STRUCTURE_FORM_MESSAGE_KEYS);
export const termFormSchema = createTermFormSchema(STRUCTURE_FORM_MESSAGE_KEYS);
export const classFormSchema = createClassFormSchema(STRUCTURE_FORM_MESSAGE_KEYS);
export const sectionFormSchema = createSectionFormSchema(STRUCTURE_FORM_MESSAGE_KEYS);
export const subjectFormSchema = createSubjectFormSchema(STRUCTURE_FORM_MESSAGE_KEYS);

export type CampusFormValues = z.infer<typeof campusFormSchema>;
export type DepartmentFormValues = z.infer<typeof departmentFormSchema>;
export type HouseFormValues = z.infer<typeof houseFormSchema>;
export type HolidayFormValues = z.infer<typeof holidayFormSchema>;
export type SessionFormValues = z.infer<typeof sessionFormSchema>;
export type TermFormValues = z.infer<typeof termFormSchema>;
export type ClassFormValues = z.infer<typeof classFormSchema>;
export type SectionFormValues = z.infer<typeof sectionFormSchema>;
export type SubjectFormValues = z.infer<typeof subjectFormSchema>;
