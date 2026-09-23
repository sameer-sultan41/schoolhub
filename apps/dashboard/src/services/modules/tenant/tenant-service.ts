import type { Tenant } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";

/**
 * The tenant domain's API calls. Every dashboard consumer reaches these through
 * `Services.tenant.*` (see `@/services`) — never by importing this file directly and
 * never by importing `@/lib/auth`'s `apiClient` directly.
 */

/** The authenticated user's own tenant — name, branding, locale, contact. */
export async function fetchCurrentTenant(): Promise<Tenant> {
  const { data } = await apiClient.get<Tenant>(endpoints.tenant.current);
  return data;
}
