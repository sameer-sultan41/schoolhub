import { z } from "zod";

/**
 * Mirrors the API's promotion validations (academics.md §11). The rules that need
 * server state are deliberately absent and reach the forms through
 * `ApiError.fieldErrors()`: the target session must be writable, a batch may not
 * already exist for this class and session pair, the class must have actively
 * enrolled students, an override reason is required wherever the decision differs
 * from the system's proposal, and the approver may not be the preparer.
 *
 * NOTE: like staff-schema.ts's identical note, these messages are plain English,
 * not translation keys — this codebase has no established pattern yet for
 * translating client-side Zod/RHF messages.
 */
export const promotionBatchSchema = z
  .object({
    from_academic_session_id: z.string().min(1),
    to_academic_session_id: z.string().min(1),
    class_id: z.string().min(1),
  })
  .refine((values) => values.from_academic_session_id !== values.to_academic_session_id, {
    message: "The target session must differ from the source.",
    path: ["to_academic_session_id"],
  });

export type PromotionBatchFormValues = z.infer<typeof promotionBatchSchema>;

/**
 * One student's decision inside a batch. The target-class rule mirrors the
 * `promotions_target_class_matches_decision` database constraint exactly, so the
 * reviewer gets a field error rather than a 409 from Postgres: `graduated` is the
 * only decision with no target class, and every other one requires one.
 */
export const promotionDecisionSchema = z
  .object({
    decision: z.enum(["promoted", "retained", "promoted_on_trial", "graduated"]),
    to_class_id: z.string().optional().or(z.literal("")),
    to_section_id: z.string().optional().or(z.literal("")),
    override_reason: z.string().max(500).optional().or(z.literal("")),
    remarks: z.string().max(500).optional().or(z.literal("")),
  })
  .refine((values) => values.decision !== "graduated" || !values.to_class_id, {
    message: "A graduating student has no target class.",
    path: ["to_class_id"],
  })
  .refine((values) => values.decision === "graduated" || Boolean(values.to_class_id), {
    message: "A target class is required unless the student is graduating.",
    path: ["to_class_id"],
  });

export type PromotionDecisionFormValues = z.infer<typeof promotionDecisionSchema>;
