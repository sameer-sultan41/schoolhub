import type { RefundStatus } from "@/services";

/**
 * Each refund status's message key in the `fees` namespace, and its badge variant. Exhaustive
 * records (L32): a value the generated enum gains fails to compile here until it is labelled.
 */

export const REFUND_STATUS_LABEL_KEY: Record<RefundStatus, string> = {
  requested: "payments.refunds.status.requested",
  approved: "payments.refunds.status.approved",
  rejected: "payments.refunds.status.rejected",
  processed: "payments.refunds.status.processed",
};

export const REFUND_STATUS_BADGE: Record<
  RefundStatus,
  "primary" | "success" | "warning" | "destructive" | "secondary"
> = {
  requested: "warning",
  approved: "primary",
  rejected: "destructive",
  processed: "success",
};
