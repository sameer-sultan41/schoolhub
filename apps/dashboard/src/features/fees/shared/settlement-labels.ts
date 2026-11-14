import type { SettlementImportStatus } from "@/services";

/**
 * Each settlement import status's message key in the `fees` namespace, and its badge variant.
 * Exhaustive records (L32).
 */

export const SETTLEMENT_STATUS_LABEL_KEY: Record<SettlementImportStatus, string> = {
  processing: "payments.imports.status.processing",
  completed: "payments.imports.status.completed",
  failed: "payments.imports.status.failed",
};

export const SETTLEMENT_STATUS_BADGE: Record<
  SettlementImportStatus,
  "primary" | "success" | "warning" | "destructive" | "secondary"
> = {
  processing: "warning",
  completed: "success",
  failed: "destructive",
};
