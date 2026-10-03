import { z } from "zod";
import { EXIT_REASON_MAX_LENGTH } from "./staff-constant";

/**
 * The staff module's Zod schemas — single source of truth, so a schema (and its
 * inferred form-values type) isn't redeclared per feature file. Pure validation only;
 * defaults, mappers and submit-building logic stay in their own feature files.
 */

const addressSchema = z.object({
  line1: z.string().optional(),
  line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postal_code: z.string().optional(),
  country: z.string().optional(),
});

/**
 * Field names are snake_case (matching the API's own field names) rather than this
 * codebase's usual camelCase, deliberately — `error.fieldErrors()` keys come back
 * snake_case from the server, and matching them 1:1 here means the server-error-mapping
 * loop needs no re-mapping step, mirroring `login-form.tsx`'s pattern.
 *
 * Every required/optional split matches the real `create_staff` service signature
 * (`apps/api/apps/staff_management/services.py`) exactly: `campus_id`, `joining_date`,
 * `first_name`, `last_name`, `staff_type`, `phone` required; everything else optional.
 * Zod here is instant client-side feedback only — the API remains the authority.
 */
export const staffFormSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  gender: z.string().optional(),
  date_of_birth: z.string().optional(),
  photo_file_id: z.string().optional(),
  staff_type: z.string().min(1),
  campus_id: z.string().min(1),
  department_id: z.string().optional(),
  designation_id: z.string().optional(),
  reports_to_staff_id: z.string().optional(),
  employment_type: z.string().optional(),
  joining_date: z.string().min(1),
  phone: z.string().min(1),
  email: z.literal("").or(z.email()).optional(),
  national_id: z.string().optional(),
  public_bio: z.string().optional(),
  // Not `.optional()` at this level, unlike every other optional field above: this
  // form's own default values (both `EMPTY_DEFAULTS` and `detailToFormValues`) always
  // populate a full address object (each sub-field an empty string when unset), so
  // `address` itself is never actually absent — only its individual sub-fields are.
  address: addressSchema,
});

export type StaffFormValues = z.infer<typeof staffFormSchema>;

export const exitFormSchema = z.object({
  exit_date: z.string().min(1, "Exit date is required"),
  exit_reason: z
    .string()
    .min(1, "Exit reason is required")
    .max(
      EXIT_REASON_MAX_LENGTH,
      `Exit reason must be ${EXIT_REASON_MAX_LENGTH} characters or fewer`,
    ),
  // Genuinely optional — "" (the untouched default, and the Select's own placeholder
  // state) is mapped to "field omitted" below, exactly like `exitStaff` expects, never
  // sent through as a literal empty string.
  exit_type: z.string().optional(),
});

export type ExitFormValues = z.infer<typeof exitFormSchema>;
