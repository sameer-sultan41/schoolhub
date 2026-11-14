import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toIssueVoucherBody, toVouchersQueryParams } from "./vouchers-helper";
import type {
  IssueVoucherInput,
  VoucherFormat,
  VoucherRecord,
  VouchersQuery,
} from "./vouchers-type";

/** One page of fee vouchers: a guardian's are their own children's, the server decides. */
export async function listVouchers(query: VouchersQuery = {}): Promise<Page<VoucherRecord>> {
  return fetchPage<VoucherRecord>(apiClient, endpoints.vouchers.list, {
    query: toVouchersQueryParams(query),
  });
}

/** A voucher's PDF, streamed with the bearer token (a bare anchor would send none). */
export async function downloadVoucher(id: string, format: VoucherFormat = "pdf"): Promise<Blob> {
  return apiClient.downloadBlob(endpoints.vouchers.download(id), { query: { format } });
}

/**
 * Prints a slip for an invoice's balance (`POST /fee-invoices/{id}/vouchers`,
 * `fees.payment.collect`). The amount, consumer number and due date are the server's; a canceled
 * or settled invoice is a 422 under `fee_invoice`.
 */
export async function issueVoucher(
  invoiceId: string,
  input: IssueVoucherInput,
): Promise<VoucherRecord> {
  const { data } = await apiClient.post<VoucherRecord>(
    endpoints.vouchers.issue(invoiceId),
    toIssueVoucherBody(input),
  );
  return data;
}

/** Voids a slip with a required reason (`POST /vouchers/{id}:void`). A paid one is a 422 under `status`. */
export async function voidVoucher(id: string, reason: string): Promise<VoucherRecord> {
  const { data } = await apiClient.post<VoucherRecord>(endpoints.vouchers.void(id), { reason });
  return data;
}
