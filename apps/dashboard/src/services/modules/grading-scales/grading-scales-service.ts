import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toBandBody, toScaleBody, toScaleQueryParams } from "./grading-scales-helper";
import type {
  GradeBandInput,
  GradeBandRecord,
  GradingScaleInput,
  GradingScalePageQuery,
  GradingScaleRecord,
} from "./grading-scales-type";

/** The grading-scales API calls (`/grading-scales`), reached through `Services.gradingScales.*`. */

export async function fetchScalesPage(
  query: GradingScalePageQuery,
): Promise<Page<GradingScaleRecord>> {
  return fetchPage<GradingScaleRecord>(apiClient, endpoints.gradingScales.list, {
    query: toScaleQueryParams(query),
  });
}

export async function fetchScale(id: string): Promise<GradingScaleRecord> {
  const { data } = await apiClient.get<GradingScaleRecord>(endpoints.gradingScales.detail(id));
  return data;
}

export async function createScale(input: GradingScaleInput): Promise<GradingScaleRecord> {
  const { data } = await apiClient.post<GradingScaleRecord>(
    endpoints.gradingScales.list,
    toScaleBody(input),
  );
  return data;
}

export async function updateScale(
  id: string,
  input: GradingScaleInput,
): Promise<GradingScaleRecord> {
  const { data } = await apiClient.patch<GradingScaleRecord>(
    endpoints.gradingScales.detail(id),
    toScaleBody(input),
  );
  return data;
}

export async function deleteScale(id: string): Promise<void> {
  await apiClient.delete(endpoints.gradingScales.detail(id));
}

/** Moves the school's default to this scale: a colon-action, never a PATCH of `is_default`,
 * since it clears the outgoing default in the same transaction. */
export async function setDefault(id: string): Promise<GradingScaleRecord> {
  const { data } = await apiClient.post<GradingScaleRecord>(endpoints.gradingScales.setDefault(id));
  return data;
}

/** A scale's bands in display order: unpaginated, a scale has a handful. */
export async function fetchBands(scaleId: string): Promise<GradeBandRecord[]> {
  const { data } = await apiClient.get<GradeBandRecord[]>(endpoints.gradingScales.bands(scaleId));
  return data;
}

export async function createBand(scaleId: string, input: GradeBandInput): Promise<GradeBandRecord> {
  const { data } = await apiClient.post<GradeBandRecord>(
    endpoints.gradingScales.bands(scaleId),
    toBandBody(input),
  );
  return data;
}

export async function updateBand(
  scaleId: string,
  bandId: string,
  input: GradeBandInput,
): Promise<GradeBandRecord> {
  const { data } = await apiClient.patch<GradeBandRecord>(
    endpoints.gradingScales.band(scaleId, bandId),
    toBandBody(input),
  );
  return data;
}

export async function deleteBand(scaleId: string, bandId: string): Promise<void> {
  await apiClient.delete(endpoints.gradingScales.band(scaleId, bandId));
}
