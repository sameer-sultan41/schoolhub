import { fetchPage, MAX_PAGE_SIZE } from "@schoolhub/api-client";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";

/**
 * The school-organization domain's reference-data calls. Every consumer reaches these
 * through `Services.schoolOrganization.*` (see `@/services`) — never by importing this
 * file directly and never by importing `@schoolhub/api-client` directly.
 */

export interface SchoolOrganizationOption {
  id: string;
  name: string;
}

/** `GET /houses` — every house, for a reference-data select/filter. */
export async function fetchHouses(): Promise<SchoolOrganizationOption[]> {
  const { items } = await fetchPage<SchoolOrganizationOption>(
    apiClient,
    endpoints.schoolOrganization.houses,
    { query: { page_size: MAX_PAGE_SIZE } },
  );
  return items;
}
