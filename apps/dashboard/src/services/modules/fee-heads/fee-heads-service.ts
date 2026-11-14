import { collectPages, fetchPage, MAX_PAGE_SIZE } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toFeeHeadBody, toFeeHeadsQueryParams } from "./fee-heads-helper";
import type { FeeHeadInput, FeeHeadRecord, FeeHeadsQuery } from "./fee-heads-type";

/** The fee-heads API calls (`/fee-heads`), reached through `Services.feeHeads.*`. */

export async function listFeeHeads(query: FeeHeadsQuery = {}): Promise<Page<FeeHeadRecord>> {
  return fetchPage<FeeHeadRecord>(apiClient, endpoints.feeHeads.list, {
    query: toFeeHeadsQueryParams(query),
  });
}

/** Every fee head, for a picker or a name lookup: all pages, in code order. */
export async function fetchFeeHeadOptions(): Promise<FeeHeadRecord[]> {
  return collectPages<FeeHeadRecord>(apiClient, endpoints.feeHeads.list, {
    query: toFeeHeadsQueryParams({ ordering: "code", pageSize: MAX_PAGE_SIZE }),
  });
}

export async function fetchFeeHead(id: string): Promise<FeeHeadRecord> {
  const { data } = await apiClient.get<FeeHeadRecord>(endpoints.feeHeads.detail(id));
  return data;
}

export async function createFeeHead(input: FeeHeadInput): Promise<FeeHeadRecord> {
  const { data } = await apiClient.post<FeeHeadRecord>(
    endpoints.feeHeads.list,
    toFeeHeadBody(input),
  );
  return data;
}

export async function updateFeeHead(
  id: string,
  input: Partial<FeeHeadInput>,
): Promise<FeeHeadRecord> {
  const { data } = await apiClient.patch<FeeHeadRecord>(
    endpoints.feeHeads.detail(id),
    toFeeHeadBody(input),
  );
  return data;
}

export async function deleteFeeHead(id: string): Promise<void> {
  await apiClient.delete(endpoints.feeHeads.detail(id));
}
