import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toFineBody, toFinesQueryParams } from "./fines-helper";
import type { FineInput, FineRecord, FinesQuery } from "./fines-type";

/** The fines API calls (`/fines`), reached through `Services.fines.*`. There is no delete: the route does not exist. */

export async function listFines(query: FinesQuery = {}): Promise<Page<FineRecord>> {
  return fetchPage<FineRecord>(apiClient, endpoints.fines.list, {
    query: toFinesQueryParams(query),
  });
}

export async function createFine(input: FineInput): Promise<FineRecord> {
  const { data } = await apiClient.post<FineRecord>(endpoints.fines.list, toFineBody(input));
  return data;
}

export async function updateFine(id: string, input: Partial<FineInput>): Promise<FineRecord> {
  const { data } = await apiClient.patch<FineRecord>(endpoints.fines.detail(id), toFineBody(input));
  return data;
}

/** A colon-action (`/fines/{id}:waive`) with a required reason. Refused (422 on `status`) unless the fine is pending. */
export async function waiveFine(id: string, reason: string): Promise<FineRecord> {
  const { data } = await apiClient.post<FineRecord>(endpoints.fines.waive(id), { reason });
  return data;
}
