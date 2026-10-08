import { z } from "zod";

/**
 * The student-transfers module's Zod schemas. Field names are snake_case, matching the
 * API's own request body (`assert_transfer_campus_fields`) field for field — same
 * convention as `students.schema.ts`/`guardians.schema.ts`.
 *
 * `incoming` is deliberately not a branch here — see the spec's Alternatives section.
 * `to_campus_id` must never appear on `outgoing`, and `external_school_name` must never
 * appear on `inter_campus` — the server rejects both combinations, and
 * `z.discriminatedUnion` strips whichever branch's field doesn't belong.
 */
const baseFields = {
  reason: z.string().min(1),
  effective_date: z.string().min(1),
};

export const requestTransferFormSchema = z.discriminatedUnion("transfer_type", [
  z.object({
    transfer_type: z.literal("inter_campus"),
    from_campus_id: z.string().min(1),
    to_campus_id: z.string().min(1),
    ...baseFields,
  }),
  z.object({
    transfer_type: z.literal("outgoing"),
    from_campus_id: z.string().min(1),
    external_school_name: z.string().min(1),
    ...baseFields,
  }),
]);

export type RequestTransferFormValues = z.infer<typeof requestTransferFormSchema>;
