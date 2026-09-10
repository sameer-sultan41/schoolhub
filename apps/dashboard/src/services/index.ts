import { AuthService } from "./modules/auth";
import { DashboardService } from "./modules/dashboard";

/**
 * Every domain's API calls, aggregated behind one object. A component imports `Services`
 * and calls `Services.<domain>.<action>(...)` — never `apiClient` and never a service
 * module's file directly — so every call site self-documents which domain it's calling
 * into (see `src/services/endpoints.ts` for the path-centralization half of this
 * convention).
 *
 * Add a domain here the moment its module lands, following the same
 * `services/modules/<domain>/{<domain>-service.ts,index.ts}` shape as `auth` and
 * `dashboard`.
 */
export const Services = {
  auth: AuthService,
  dashboard: DashboardService,
} as const;
