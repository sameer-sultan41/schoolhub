import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type { JobAccepted } from "@/services/modules/jobs/jobs-service";
import type { VoucherProvider } from "@/services/modules/vouchers/vouchers-type";
import {
  toSettlementImportsQueryParams,
  toSettlementUploadBody,
} from "./settlement-imports-helper";
import type { SettlementImportRecord, SettlementImportsQuery } from "./settlement-imports-type";

/** The settlement-import API calls (`/voucher-collection-imports`), reached through `Services.settlementImports.*`. */

export async function listSettlementImports(
  query: SettlementImportsQuery = {},
): Promise<Page<SettlementImportRecord>> {
  return fetchPage<SettlementImportRecord>(apiClient, endpoints.settlementImports.list, {
    query: toSettlementImportsQueryParams(query),
  });
}

/** One import with its exception rows. */
export async function fetchSettlementImport(id: string): Promise<SettlementImportRecord> {
  const { data } = await apiClient.get<SettlementImportRecord>(
    endpoints.settlementImports.detail(id),
  );
  return data;
}

/**
 * Uploads a provider's settlement file (`POST /voucher-collection-imports`, multipart,
 * `fees.payment.collect`) -> `202` + a job to poll. The `Idempotency-Key` binds the file by its
 * digest, so a retry of the same upload replays the first job instead of reconciling twice; a
 * different file under the same key is a 422.
 */
export async function uploadSettlementImport(
  file: File,
  provider: VoucherProvider,
  idempotencyKey: string,
): Promise<{ jobId: string }> {
  const { data } = await apiClient.post<JobAccepted>(
    endpoints.settlementImports.list,
    toSettlementUploadBody(file, provider),
    { idempotencyKey },
  );
  return { jobId: data.job_id };
}
