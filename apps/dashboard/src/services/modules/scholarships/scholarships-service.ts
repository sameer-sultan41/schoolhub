import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toScholarshipBody, toScholarshipsQueryParams } from "./scholarships-helper";
import type { ScholarshipInput, ScholarshipRecord, ScholarshipsQuery } from "./scholarships-type";

/** The scholarships API calls (`/scholarships`), reached through `Services.scholarships.*`. There is no delete: the route does not exist. */

export async function listScholarships(
  query: ScholarshipsQuery = {},
): Promise<Page<ScholarshipRecord>> {
  return fetchPage<ScholarshipRecord>(apiClient, endpoints.scholarships.list, {
    query: toScholarshipsQueryParams(query),
  });
}

export async function createScholarship(input: ScholarshipInput): Promise<ScholarshipRecord> {
  const { data } = await apiClient.post<ScholarshipRecord>(
    endpoints.scholarships.list,
    toScholarshipBody(input),
  );
  return data;
}

/** A PATCH. The lifecycle moves through it: `{ status, notes }`, and the server refuses (422 on `status`) any move its table does not allow. */
export async function updateScholarship(
  id: string,
  input: Partial<ScholarshipInput>,
): Promise<ScholarshipRecord> {
  const { data } = await apiClient.patch<ScholarshipRecord>(
    endpoints.scholarships.detail(id),
    toScholarshipBody(input),
  );
  return data;
}
