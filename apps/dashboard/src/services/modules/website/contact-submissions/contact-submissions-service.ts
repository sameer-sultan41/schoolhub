import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";

import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toContactSubmissionQueryParams } from "./contact-submissions-helper";
import type {
  ContactSubmissionQuery,
  ContactSubmissionRecord,
  ContactSubmissionStatus,
} from "./contact-submissions-type";

/** The contact inbox API calls (`/contact-submissions`), through `Services.contactSubmissions.*`. */

const paths = endpoints.website.contactSubmissions;

export async function fetchContactSubmissionPage(
  query: ContactSubmissionQuery = {},
): Promise<Page<ContactSubmissionRecord>> {
  return fetchPage<ContactSubmissionRecord>(apiClient, paths.list, {
    query: toContactSubmissionQueryParams(query),
  });
}

export async function fetchContactSubmission(id: string): Promise<ContactSubmissionRecord> {
  const { data } = await apiClient.get<ContactSubmissionRecord>(paths.detail(id));
  return data;
}

/** Triage: mark a submission read, responded or spam. */
export async function setContactSubmissionStatus(
  id: string,
  status: ContactSubmissionStatus,
): Promise<ContactSubmissionRecord> {
  const { data } = await apiClient.patch<ContactSubmissionRecord>(paths.detail(id), { status });
  return data;
}
