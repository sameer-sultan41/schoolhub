import type { RequestTransferFormValues } from "./student-transfers.schema";
import type { RequestTransferInput } from "./student-transfers-type";

/**
 * The student-transfers module's pure helper functions — single source of truth, so this
 * mapping isn't reimplemented per call site. Plain data in, plain data out; no React, no
 * API calls.
 */

/** `RequestTransferFormValues` (snake_case, the Zod form shape) -> `RequestTransferInput`
 * (camelCase, the service input shape) — same bridging role as
 * `formValuesToCreateGuardianInput` (`guardians-helper.ts`). */
export function formValuesToRequestTransferInput(
  values: RequestTransferFormValues,
): RequestTransferInput {
  if (values.transfer_type === "inter_campus") {
    return {
      transferType: "inter_campus",
      fromCampusId: values.from_campus_id,
      toCampusId: values.to_campus_id,
      reason: values.reason,
      effectiveDate: values.effective_date,
    };
  }
  return {
    transferType: "outgoing",
    fromCampusId: values.from_campus_id,
    externalSchoolName: values.external_school_name,
    reason: values.reason,
    effectiveDate: values.effective_date,
  };
}
