import type {
  DiscountStatus,
  DiscountType,
  FineStatus,
  FineType,
  ScholarshipStatus,
  ScholarshipType,
} from "@/services";

/**
 * Each grant enum's value to its message key in the `fees` namespace, and each status's badge
 * variant. Exhaustive records (L32): a value the generated enum gains fails to compile here
 * until it is labelled.
 */

type BadgeVariant = "primary" | "success" | "warning" | "destructive" | "secondary";

export const GRANT_VALUE_TYPE_LABEL_KEY: Record<DiscountType, string> = {
  percent: "grants.valueType.percent",
  fixed: "grants.valueType.fixed",
};

export const DISCOUNT_STATUS_LABEL_KEY: Record<DiscountStatus, string> = {
  active: "grants.discounts.status.active",
  expired: "grants.discounts.status.expired",
  revoked: "grants.discounts.status.revoked",
};
export const DISCOUNT_STATUS_BADGE: Record<DiscountStatus, BadgeVariant> = {
  active: "success",
  expired: "secondary",
  revoked: "destructive",
};

export const SCHOLARSHIP_STATUS_LABEL_KEY: Record<ScholarshipStatus, string> = {
  applied: "grants.scholarships.status.applied",
  approved: "grants.scholarships.status.approved",
  active: "grants.scholarships.status.active",
  ended: "grants.scholarships.status.ended",
  revoked: "grants.scholarships.status.revoked",
};
export const SCHOLARSHIP_STATUS_BADGE: Record<ScholarshipStatus, BadgeVariant> = {
  applied: "warning",
  approved: "primary",
  active: "success",
  ended: "secondary",
  revoked: "destructive",
};
export const SCHOLARSHIP_TYPE_LABEL_KEY: Record<ScholarshipType, string> = {
  merit: "grants.scholarships.type.merit",
  need: "grants.scholarships.type.need",
  sports: "grants.scholarships.type.sports",
  staff_ward: "grants.scholarships.type.staff_ward",
  other: "grants.scholarships.type.other",
};
/** The button that moves an award to each status (the move's verb, not the status's name). */
export const SCHOLARSHIP_ACTION_LABEL_KEY: Record<ScholarshipStatus, string> = {
  applied: "grants.scholarships.actions.to.applied",
  approved: "grants.scholarships.actions.to.approved",
  active: "grants.scholarships.actions.to.active",
  ended: "grants.scholarships.actions.to.ended",
  revoked: "grants.scholarships.actions.to.revoked",
};

export const FINE_STATUS_LABEL_KEY: Record<FineStatus, string> = {
  pending: "grants.fines.status.pending",
  invoiced: "grants.fines.status.invoiced",
  paid: "grants.fines.status.paid",
  waived: "grants.fines.status.waived",
};
export const FINE_STATUS_BADGE: Record<FineStatus, BadgeVariant> = {
  pending: "warning",
  invoiced: "primary",
  paid: "success",
  waived: "secondary",
};
export const FINE_TYPE_LABEL_KEY: Record<FineType, string> = {
  late_fee: "grants.fines.type.late_fee",
  library: "grants.fines.type.library",
  transport: "grants.fines.type.transport",
  damage: "grants.fines.type.damage",
  discipline: "grants.fines.type.discipline",
  other: "grants.fines.type.other",
};
