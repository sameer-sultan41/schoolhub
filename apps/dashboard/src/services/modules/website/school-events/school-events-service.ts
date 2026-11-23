import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";

import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toSchoolEventQueryParams } from "./school-events-helper";
import type {
  SchoolEventDetail,
  SchoolEventInput,
  SchoolEventQuery,
  SchoolEventRecord,
  SchoolEventUpdateInput,
} from "./school-events-type";

/** The website events API calls (`/school-events`), reached through `Services.schoolEvents.*`. */

const paths = endpoints.website.schoolEvents;

export async function fetchSchoolEventPage(
  query: SchoolEventQuery = {},
): Promise<Page<SchoolEventRecord>> {
  return fetchPage<SchoolEventRecord>(apiClient, paths.list, {
    query: toSchoolEventQueryParams(query),
  });
}

export async function fetchSchoolEvent(id: string): Promise<SchoolEventDetail> {
  const { data } = await apiClient.get<SchoolEventDetail>(paths.detail(id));
  return data;
}

export async function createSchoolEvent(input: SchoolEventInput): Promise<SchoolEventDetail> {
  const { data } = await apiClient.post<SchoolEventDetail>(paths.list, input);
  return data;
}

export async function updateSchoolEvent(
  id: string,
  input: SchoolEventUpdateInput,
): Promise<SchoolEventDetail> {
  const { data } = await apiClient.patch<SchoolEventDetail>(paths.detail(id), input);
  return data;
}

export async function publishSchoolEvent(id: string): Promise<SchoolEventDetail> {
  const { data } = await apiClient.post<SchoolEventDetail>(paths.publish(id));
  return data;
}

export async function unpublishSchoolEvent(id: string): Promise<SchoolEventDetail> {
  const { data } = await apiClient.post<SchoolEventDetail>(paths.unpublish(id));
  return data;
}

export async function archiveSchoolEvent(id: string): Promise<SchoolEventDetail> {
  const { data } = await apiClient.post<SchoolEventDetail>(paths.archive(id));
  return data;
}
