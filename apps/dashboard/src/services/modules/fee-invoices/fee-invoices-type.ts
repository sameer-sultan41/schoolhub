import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shape (ADR-0017). */
export type FeeInvoiceRecord = ApiSchemas["FeeInvoice"];
export type FeeInvoiceStatus = FeeInvoiceRecord["status"];
export type FeeInvoiceLineRecord = FeeInvoiceRecord["lines"][number];

export interface FeeInvoicesQuery {
  studentId?: string;
  academicSessionId?: string;
  feeStructureId?: string;
  status?: FeeInvoiceStatus;
  periodLabel?: string;
  dueDateGte?: string;
  dueDateLte?: string;
  /** `true`: everything still owing money (the defaulter list); `false`: nothing owing. */
  outstanding?: boolean;
  search?: string;
  ordering?: string;
  cursor?: string;
  pageSize?: number;
}

/**
 * An ad-hoc invoice's header. The API takes no lines on create (`FeeInvoiceSerializer.lines` is
 * read-only), so the invoice starts as a zero-total draft.
 */
export interface FeeInvoiceInput {
  studentId: string;
  academicSessionId: string;
  issueDate: string;
  dueDate: string;
  periodLabel?: string | null;
}

/** Exactly one of `periodStart` (a calendar month) or `termId` names the period. */
export interface GenerateInvoicesInput {
  feeStructureId: string;
  periodStart?: string | null;
  termId?: string | null;
}

/** The `202` of `:generate`: the job to poll. */
export interface GenerateInvoicesAccepted {
  jobId: string;
}

/** A finished generation job's `result` (`services.generate_invoices`): invoices raised and
 * students already billed for the period. */
export interface GenerateInvoicesResult {
  issued: number;
  skipped: number;
}
