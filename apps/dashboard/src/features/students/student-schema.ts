import { z } from "zod";

/**
 * Mirrors the API's validation (module doc §11) so the user gets instant
 * feedback, but the API remains the authority — see student-form.tsx's
 * ApiError.fieldErrors() handling. admission_number is deliberately not a
 * field here: it is server-generated on create and immutable after, never a
 * form input (see the backend serializer's comment on why it is merely
 * `required=False`, not read-only, at the wire level).
 *
 * NOTE: like login-form.tsx's schema, these messages are plain English, not
 * translation keys — this codebase has no established pattern yet for
 * translating client-side Zod/RHF messages (only server error envelopes and
 * static UI strings go through next-intl today). Flagged as a gap to close
 * project-wide, not papered over here.
 */
export const studentSchema = z
  .object({
    first_name: z.string().min(1).max(100),
    last_name: z.string().min(1).max(100),
    preferred_name: z.string().max(100).optional().or(z.literal("")),
    date_of_birth: z
      .string()
      .min(1)
      .refine((value) => new Date(value) <= new Date(), {
        message: "Date of birth cannot be in the future.",
      }),
    gender: z.enum(["male", "female", "other", "unspecified"]),
    campus_id: z.string().min(1),
    house_id: z.string().optional().or(z.literal("")),
    admission_date: z.string().min(1),
    blood_group: z.string().max(8).optional().or(z.literal("")),
    nationality: z.string().max(80).optional().or(z.literal("")),
    religion: z.string().max(80).optional().or(z.literal("")),
    previous_school: z.string().max(200).optional().or(z.literal("")),
    medical_notes: z.string().optional().or(z.literal("")),
  })
  .refine((values) => new Date(values.date_of_birth) < new Date(values.admission_date), {
    message: "Admission date must be after the date of birth.",
    path: ["admission_date"],
  });

export type StudentFormValues = z.infer<typeof studentSchema>;
