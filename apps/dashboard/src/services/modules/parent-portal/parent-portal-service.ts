import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type { PortalDashboard } from "./parent-portal-type";

/** The parent portal's API calls. Reached through `Services.parentPortal.*` (see `@/services`). */

/** The caller's children, unread counts and which module tabs the school has on. */
export async function fetchPortalDashboard(): Promise<PortalDashboard> {
  const { data } = await apiClient.get<PortalDashboard>(endpoints.parentPortal.dashboard);
  return data;
}
