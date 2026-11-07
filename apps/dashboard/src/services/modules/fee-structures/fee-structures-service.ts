import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toFeeStructureBody, toFeeStructuresQueryParams } from "./fee-structures-helper";
import type {
  FeeStructureInput,
  FeeStructureRecord,
  FeeStructuresQuery,
} from "./fee-structures-type";

/** The fee-structures API calls (`/fee-structures`), reached through `Services.feeStructures.*`. */

export async function listFeeStructures(
  query: FeeStructuresQuery = {},
): Promise<Page<FeeStructureRecord>> {
  return fetchPage<FeeStructureRecord>(apiClient, endpoints.feeStructures.list, {
    query: toFeeStructuresQueryParams(query),
  });
}

export async function fetchFeeStructure(id: string): Promise<FeeStructureRecord> {
  const { data } = await apiClient.get<FeeStructureRecord>(endpoints.feeStructures.detail(id));
  return data;
}

export async function createFeeStructure(input: FeeStructureInput): Promise<FeeStructureRecord> {
  const { data } = await apiClient.post<FeeStructureRecord>(
    endpoints.feeStructures.list,
    toFeeStructureBody(input),
  );
  return data;
}

export async function updateFeeStructure(
  id: string,
  input: Partial<FeeStructureInput>,
): Promise<FeeStructureRecord> {
  const { data } = await apiClient.patch<FeeStructureRecord>(
    endpoints.feeStructures.detail(id),
    toFeeStructureBody(input),
  );
  return data;
}

export async function deleteFeeStructure(id: string): Promise<void> {
  await apiClient.delete(endpoints.feeStructures.detail(id));
}

/** A colon-action (`/fee-structures/{id}:activate`), never a PATCH of `status`. */
export async function activateFeeStructure(id: string): Promise<FeeStructureRecord> {
  const { data } = await apiClient.post<FeeStructureRecord>(endpoints.feeStructures.activate(id));
  return data;
}

/** A colon-action (`/fee-structures/{id}:archive`), never a PATCH of `status`. */
export async function archiveFeeStructure(id: string): Promise<FeeStructureRecord> {
  const { data } = await apiClient.post<FeeStructureRecord>(endpoints.feeStructures.archive(id));
  return data;
}
