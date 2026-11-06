import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toVouchersQueryParams } from "./vouchers-helper";
import type { VoucherFormat, VoucherRecord, VouchersQuery } from "./vouchers-type";

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
