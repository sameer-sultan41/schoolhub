import type {
  PromotionBatchFormValues,
  PromotionDecisionFormValues,
} from "@/features/academics/promotion-schema";

/** Whitelist of server field names the create-batch form has an input for.
 * `services.create_promotion_batch` also raises against `batch_id` and
 * `non_field`, neither of which has a control here. Mirrors
 * staff/map-field-errors.ts exactly. */
const BATCH_FIELDS = new Set<keyof PromotionBatchFormValues>([
  "from_academic_session_id",
  "to_academic_session_id",
  "class_id",
]);

/** Whitelist of server field names the decision editor has an input for. Every
 * other field on the serializer is read-only (they are fixed at batch creation or
 * moved only by the colon-actions), so anything else is a "root" message. */
const DECISION_FIELDS = new Set<keyof PromotionDecisionFormValues>([
  "decision",
  "to_class_id",
  "to_section_id",
  "override_reason",
  "remarks",
]);

function partition<TValues>(
  known: Set<keyof TValues>,
  fieldErrors: Record<string, string>,
): { known: Partial<Record<keyof TValues, string>>; unknown: string[] } {
  const matched: Partial<Record<keyof TValues, string>> = {};
  const unmatched: string[] = [];

  for (const [field, issue] of Object.entries(fieldErrors)) {
    if (known.has(field as keyof TValues)) {
      matched[field as keyof TValues] = issue;
    } else {
      unmatched.push(issue);
    }
  }

  return { known: matched, unknown: unmatched };
}

export function mapPromotionBatchFieldErrors(fieldErrors: Record<string, string>) {
  return partition<PromotionBatchFormValues>(BATCH_FIELDS, fieldErrors);
}

export function mapPromotionDecisionFieldErrors(fieldErrors: Record<string, string>) {
  return partition<PromotionDecisionFormValues>(DECISION_FIELDS, fieldErrors);
}
