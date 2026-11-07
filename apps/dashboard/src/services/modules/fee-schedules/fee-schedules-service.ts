import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toFeeScheduleBody, toFeeSchedulesQueryParams } from "./fee-schedules-helper";
import type { FeeScheduleInput, FeeScheduleRecord, FeeSchedulesQuery } from "./fee-schedules-type";

/** The fee-schedules API calls (`/fee-schedules`), reached through `Services.feeSchedules.*`. */

export async function listFeeSchedules(
  query: FeeSchedulesQuery = {},
): Promise<Page<FeeScheduleRecord>> {
  return fetchPage<FeeScheduleRecord>(apiClient, endpoints.feeSchedules.list, {
    query: toFeeSchedulesQueryParams(query),
  });
}

export async function fetchFeeSchedule(id: string): Promise<FeeScheduleRecord> {
  const { data } = await apiClient.get<FeeScheduleRecord>(endpoints.feeSchedules.detail(id));
  return data;
}

export async function createFeeSchedule(input: FeeScheduleInput): Promise<FeeScheduleRecord> {
  const { data } = await apiClient.post<FeeScheduleRecord>(
    endpoints.feeSchedules.list,
    toFeeScheduleBody(input),
  );
  return data;
}

export async function updateFeeSchedule(
  id: string,
  input: Partial<FeeScheduleInput>,
): Promise<FeeScheduleRecord> {
  const { data } = await apiClient.patch<FeeScheduleRecord>(
    endpoints.feeSchedules.detail(id),
    toFeeScheduleBody(input),
  );
  return data;
}

export async function deleteFeeSchedule(id: string): Promise<void> {
  await apiClient.delete(endpoints.feeSchedules.detail(id));
}
