import { z } from "zod";

/**
 * Mirrors the API's validation (docs/03-modules/staff-management.md §11) so the
 * user gets instant feedback, but the API remains the authority — see
 * staff-form.tsx's ApiError.fieldErrors() handling. employee_number is
 * deliberately not a field here: it is server-generated on create and
 * immutable after (see the backend serializer's comment on why it is merely
 * `required=False`, not read-only, at the wire level).
 *
 * NOTE: like student-schema.ts's identical note, these messages are plain
 * English, not translation keys — this codebase has no established pattern
 * yet for translating client-side Zod/RHF messages.
 */
export const staffSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  gender: z.enum(["male", "female", "other", "unspecified"]),
  date_of_birth: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine((value) => !value || new Date(value) <= new Date(), {
      message: "Date of birth cannot be in the future.",
    }),
  staff_type: z.enum(["teaching", "non_teaching"]),
  campus_id: z.string().min(1),
  department_id: z.string().optional().or(z.literal("")),
  designation_id: z.string().optional().or(z.literal("")),
  employment_type: z.enum(["full_time", "part_time", "contract", "visiting"]),
  joining_date: z.string().min(1),
  email: z.email().max(254).optional().or(z.literal("")),
  phone: z.string().min(1).max(32),
  national_id: z.string().max(64).optional().or(z.literal("")),
  public_bio: z.string().optional().or(z.literal("")),
});

export type StaffFormValues = z.infer<typeof staffSchema>;
