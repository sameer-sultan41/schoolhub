import type { QueryParams } from "@schoolhub/api-client";
import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import {
  FEE_INVOICE_STATUS_CANCELED,
  FEE_INVOICES_GENERATE_FIELDS,
  FEE_INVOICES_QUERY_FIELDS,
  OUTSTANDING_ON,
} from "./fee-invoices-constant";
import type { CancelInvoiceFormValues, GenerateInvoicesFormValues } from "./fee-invoices.schema";
import type {
  FeeInvoiceRecord,
  FeeInvoicesQuery,
  FeeInvoiceStatus,
  GenerateInvoicesInput,
  GenerateInvoicesResult,
} from "./fee-invoices-type";

/** The fee-invoices module's pure helpers: plain data in, plain data out. */

/** The list's query string: only the filters given are sent. */
export function toFeeInvoicesQueryParams(query: FeeInvoicesQuery): QueryParams {
  const params: Record<string, unknown> = {};
  copyMappedFields(
    query,
    FEE_INVOICES_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as QueryParams;
}

/** The generate body: the structure and the one period field the form chose. */
export function toGenerateInvoicesBody(input: GenerateInvoicesInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(
    input,
    FEE_INVOICES_GENERATE_FIELDS,
    (value) => value !== undefined && value !== null && value !== "",
    body,
  );
  return body;
}

/** A URL filter's picked status, or `undefined` for "all" (no filter sent). */
export function feeInvoiceStatusFilter(value: string): FeeInvoiceStatus | undefined {
  return value === FILTER_ALL ? undefined : (value as FeeInvoiceStatus);
}

/** `true` while the defaulters toggle is on; `undefined` (not sent) when off. */
export function outstandingFilter(value: string): true | undefined {
  return value === OUTSTANDING_ON ? true : undefined;
}

/** Whether any money has been paid against the invoice (`paid_total`, the server's own figure). */
export function hasPayments(invoice: Pick<FeeInvoiceRecord, "paid_total">): boolean {
  return Number(invoice.paid_total) > 0;
}

/**
 * Cancel is offered while nothing has been paid and the invoice is not already canceled. The
 * server decides (`cancel_invoice` refuses either as a 422); this only hides a button that
 * could not succeed.
 */
export function isInvoiceCancelable(
  invoice: Pick<FeeInvoiceRecord, "status" | "paid_total">,
): boolean {
  return invoice.status !== FEE_INVOICE_STATUS_CANCELED && !hasPayments(invoice);
}

export function defaultGenerateInvoicesFormValues(): GenerateInvoicesFormValues {
  return { fee_structure: "", by: "month", period_start: "", term: "" };
}

export function defaultCancelInvoiceFormValues(): CancelInvoiceFormValues {
  return { reason: "" };
}

/** Form values -> the service input: the month (its first day) or the term, never both (the server refuses both). */
export function buildGenerateInvoicesInput(
  values: GenerateInvoicesFormValues,
): GenerateInvoicesInput {
  return {
    feeStructureId: values.fee_structure,
    periodStart: values.by === "month" ? `${values.period_start}-01` : null,
    termId: values.by === "term" ? values.term : null,
  };
}

/** A job's `result` as the counts the generation reports; a missing count reads as zero. */
export function generationCounts(result: Record<string, unknown> | null): GenerateInvoicesResult {
  const count = (key: string) => (typeof result?.[key] === "number" ? result[key] : 0);
  return { issued: count("issued"), skipped: count("skipped") };
}
