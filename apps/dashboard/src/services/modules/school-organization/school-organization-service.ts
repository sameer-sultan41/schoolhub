import { fetchPage, MAX_PAGE_SIZE, type ApiSchemas } from "@schoolhub/api-client";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";

/**
 * The school-organization domain's reference-data calls. Every consumer reaches these
 * through `Services.schoolOrganization.*` (see `@/services`) — never by importing this
 * file directly and never by importing `@schoolhub/api-client` directly.
 */

/** The slice of the generated `House` schema a reference-data select/filter reads — derived
 * from the contract, not hand-written, per ADR-0017. */
export type SchoolOrganizationOption = Pick<ApiSchemas["House"], "id" | "name">;

/** `GET /houses` — every house, for a reference-data select/filter. */
export async function fetchHouses(): Promise<SchoolOrganizationOption[]> {
  const { items } = await fetchPage<SchoolOrganizationOption>(
    apiClient,
    endpoints.schoolOrganization.houses,
    { query: { page_size: MAX_PAGE_SIZE } },
  );
  return items;
}
