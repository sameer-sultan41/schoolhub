import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toFeeInvoicesQueryParams } from "./fee-invoices-helper";
import type { FeeInvoicesQuery, FeeInvoiceRecord } from "./fee-invoices-type";

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
