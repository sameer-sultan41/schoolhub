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
  // single-generic schema/useForm is enough. `z.preprocess` would reintroduce that same
  // Input-vs-Output mismatch (its `_input` is `unknown`), so the NaN/empty case is instead
  // normalized to `undefined` at the call site (`student-emergency-contacts-tab.tsx`'s
  // `onChange`) and this schema only needs a friendlier message for that `undefined` (or,
  // defensively, a raw `NaN` reaching this schema some other way) than zod's default
  // type-mismatch text ("Expected number, received nan"/"received undefined").
  priority: z
    .number({
      // This `error` customizer is only ever invoked for this schema's own invalid_type
      // issue (`.int()`/`.min()` below get their own separate per-check customizer slot if
      // they ever need one), so there's no `issue.code` to branch on here.
      error: (issue) =>
        issue.input === undefined || (typeof issue.input === "number" && Number.isNaN(issue.input))
          ? "Priority is required."
          : undefined,
    })
    .int()
    .min(1),
  notes: z.string().optional(),
});

export type EmergencyContactFormValues = z.infer<typeof emergencyContactSchema>;

// The file itself stays outside this schema, as its own `useState` on the dialog — same
// convention `PhotoUploadField` (Task 5) already established for an uncontrolled `<input
// type="file">`, which has no meaningful RHF "value" to validate against. Only the
// metadata fields go through RHF + zod.
//
// Field names are snake_case, matching the API's own — same convention as
// `guardianFormSchema`/`studentFormSchema` (round-5 plan review).
export const documentFormSchema = z.object({
  document_type: z.string().min(1),
  title: z.string().min(1),
  notes: z.string().optional(),
  expires_at: z.string().optional(),
});

export type DocumentFormValues = z.infer<typeof documentFormSchema>;
