import { fetchPage, MAX_PAGE_SIZE } from "@schoolhub/api-client";

import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type { CustomDomainInput, CustomDomainRecord } from "./custom-domains-type";

/** The custom domain API calls (`/custom-domains`), through `Services.customDomains.*`. */

const paths = endpoints.website.customDomains;

/** Every domain the school has added: at most `CUSTOM_DOMAIN_LIMIT`, so one page holds them. */
export async function fetchCustomDomains(): Promise<CustomDomainRecord[]> {
  const { items } = await fetchPage<CustomDomainRecord>(apiClient, paths.list, {
    query: { page_size: MAX_PAGE_SIZE },
  });
  return items;
}

/** Claim a domain; it starts `pending_dns` with the records to add. */
export async function createCustomDomain(input: CustomDomainInput): Promise<CustomDomainRecord> {
  const { data } = await apiClient.post<CustomDomainRecord>(paths.list, input);
  return data;
}

/** Check DNS now. A failed check is a 200 with `status: "failed"` and `last_error_code`. */
export async function verifyCustomDomain(id: string): Promise<CustomDomainRecord> {
  const { data } = await apiClient.post<CustomDomainRecord>(paths.verify(id));
  return data;
}

/** The only writable field is `is_primary`. */
export async function setPrimaryCustomDomain(
  id: string,
  isPrimary: boolean,
): Promise<CustomDomainRecord> {
  const { data } = await apiClient.patch<CustomDomainRecord>(paths.detail(id), {
    is_primary: isPrimary,
  });
  return data;
}

export async function deleteCustomDomain(id: string): Promise<void> {
  await apiClient.delete(paths.detail(id));
}
