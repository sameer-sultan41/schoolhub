import type { PaymentMethod, PaymentStatus } from "@/services";

/**
 * Each payment enum value to its message key in the `fees` namespace. Exhaustive records (L32):
 * a value the generated enum gains fails to compile here until it is labelled.
 */

export const PAYMENT_METHOD_LABEL_KEY: Record<PaymentMethod, string> = {
  cash: "invoices.payments.method.cash",
  cheque: "invoices.payments.method.cheque",
  bank_transfer: "invoices.payments.method.bank_transfer",
  card: "invoices.payments.method.card",
  online_gateway: "invoices.payments.method.online_gateway",
};

export const PAYMENT_STATUS_LABEL_KEY: Record<PaymentStatus, string> = {
  pending: "invoices.payments.status.pending",
  confirmed: "invoices.payments.status.confirmed",
  failed: "invoices.payments.status.failed",
  reversed: "invoices.payments.status.reversed",
};
