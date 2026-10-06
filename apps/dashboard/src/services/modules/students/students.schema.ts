import { z } from "zod";
import { GENDER_VALUES } from "@schoolhub/types";

/**
 * The students module's Zod schemas — single source of truth, so a schema (and its
 * inferred form-values type) isn't redeclared per feature file. Pure validation only;
 * defaults, mappers and submit-building logic stay in their own feature files.
 */

/** Field names are snake_case, matching the API's own — `error.fieldErrors()` keys map
 * onto these with no re-mapping step. Required fields match `REQUIRED_IMPORT_COLUMNS`
 * (`apps/api/apps/student_management/services.py`). */
export const studentFormSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  preferred_name: z.string().optional(),
  date_of_birth: z.string().min(1),
  gender: z.enum(GENDER_VALUES),
  photo_file_id: z.string().optional(),
  campus_id: z.string().min(1),
  house_id: z.string().optional(),
  admission_date: z.string().min(1),
  blood_group: z.string().optional(),
  nationality: z.string().optional(),
  religion: z.string().optional(),
  previous_school: z.string().optional(),
  medical_notes: z.string().optional(),
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  address_city: z.string().optional(),
  address_state: z.string().optional(),
  address_postal_code: z.string().optional(),
  address_country: z.string().optional(),
});

export type StudentFormValues = z.infer<typeof studentFormSchema>;

export const withdrawFormSchema = z.object({
  reason: z.string().min(1),
  effective_date: z.string().min(1),
});

export type WithdrawFormValues = z.infer<typeof withdrawFormSchema>;

// Field names are snake_case, matching the API's own — same convention as
// `guardianFormSchema`/`studentFormSchema` (round-5 plan review).
export const emergencyContactSchema = z.object({
  name: z.string().min(1),
  relationship: z.string().min(1),
  phone: z.string().min(1),
  alt_phone: z.string().optional(),
  // Plain z.number(), not z.coerce.number(): a coerced schema's input type (the raw,
  // pre-coercion form value) differs from its output type, which forces a 3-generic
  // useForm<Input, unknown, Output> that this codebase's FormField doesn't forward
  // cleanly (round-5 plan review). The number field below sets its own numeric value via
  // `valueAsNumber` instead, so RHF's internal value is already a real number and a
  // single-generic schema/useForm is enough.
  priority: z.number().int().min(1),
  notes: z.string().optional(),
});

export type EmergencyContactFormValues = z.infer<typeof emergencyContactSchema>;
