import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toPeriodBody, toPeriodQueryParams } from "./periods-helper";
import type { PeriodInput, PeriodPageQuery, PeriodRecord } from "./periods-type";

/** The bell schedule's API calls (`/periods`), reached through `Services.periods.*`. */

export async function fetchPeriodPage(query: PeriodPageQuery): Promise<Page<PeriodRecord>> {
  return fetchPage<PeriodRecord>(apiClient, endpoints.periods.list, {
    query: toPeriodQueryParams(query),
  });
}

export async function createPeriod(input: PeriodInput): Promise<PeriodRecord> {
  const { data } = await apiClient.post<PeriodRecord>(endpoints.periods.list, toPeriodBody(input));
  return data;
}

export async function updatePeriod(id: string, input: PeriodInput): Promise<PeriodRecord> {
  const { data } = await apiClient.patch<PeriodRecord>(
    endpoints.periods.detail(id),
    toPeriodBody(input),
  );
  return data;
}

export async function deletePeriod(id: string): Promise<void> {
  await apiClient.delete(endpoints.periods.detail(id));
}
