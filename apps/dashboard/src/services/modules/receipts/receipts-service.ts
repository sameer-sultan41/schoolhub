import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toReceiptsQueryParams } from "./receipts-helper";
import type { ReceiptsQuery, ReceiptRecord, ReceiptFormat } from "./receipts-type";

export async function listReceipts(query: ReceiptsQuery = {}): Promise<Page<ReceiptRecord>> {
  return fetchPage<ReceiptRecord>(apiClient, endpoints.receipts.list, {
    query: toReceiptsQueryParams(query),
  });
}

export async function fetchReceipt(id: string): Promise<ReceiptRecord> {
  const { data } = await apiClient.get<ReceiptRecord>(endpoints.receipts.detail(id));
  return data;
}

/** A receipt's PDF, streamed with the bearer token (a bare anchor would send none). */
export async function downloadReceipt(id: string, format: ReceiptFormat = "pdf"): Promise<Blob> {
  return apiClient.downloadBlob(endpoints.receipts.download(id), { query: { format } });
}
