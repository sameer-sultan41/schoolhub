import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type { JobAccepted } from "@/services/modules/jobs/jobs-service";
import { toFeeInvoicesQueryParams, toGenerateInvoicesBody } from "./fee-invoices-helper";
import type {
  FeeInvoiceRecord,
  FeeInvoicesQuery,
  GenerateInvoicesAccepted,
  GenerateInvoicesInput,
} from "./fee-invoices-type";

/** The fee-invoices API calls (`/fee-invoices`), reached through `Services.feeInvoices.*`. */

export async function listFeeInvoices(
  query: FeeInvoicesQuery = {},
): Promise<Page<FeeInvoiceRecord>> {
  return fetchPage<FeeInvoiceRecord>(apiClient, endpoints.feeInvoices.list, {
    query: toFeeInvoicesQueryParams(query),
  });
}

export async function fetchFeeInvoice(id: string): Promise<FeeInvoiceRecord> {
  const { data } = await apiClient.get<FeeInvoiceRecord>(endpoints.feeInvoices.detail(id));
  return data;
}

/**
 * Bills a structure for one period: `202` + a job. A re-run skips whoever is already billed.
 * `idempotencyKey` makes a double-click replay the first answer instead of queuing a second job.
 */
export async function generateFeeInvoices(
  input: GenerateInvoicesInput,
  idempotencyKey: string,
): Promise<GenerateInvoicesAccepted> {
  const { data } = await apiClient.post<JobAccepted>(
    endpoints.feeInvoices.generate,
    toGenerateInvoicesBody(input),
    { idempotencyKey },
  );
  return { jobId: data.job_id };
}

/** A colon-action (`/fee-invoices/{id}:cancel`) with a required reason. Refused (422) once paid. */
export async function cancelFeeInvoice(id: string, reason: string): Promise<FeeInvoiceRecord> {
  const { data } = await apiClient.post<FeeInvoiceRecord>(endpoints.feeInvoices.cancel(id), {
    reason,
  });
  return data;
}
