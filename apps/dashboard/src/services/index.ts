import { AuthService } from "./modules/auth";
import { DashboardService } from "./modules/dashboard";
import { FilesService } from "./modules/files";
import { TenantService } from "./modules/tenant";

/**
 * `ApiError` is re-exported so feature code can `instanceof`-check API failures without
 * importing `@schoolhub/api-client` — `@/services` is the only API surface outside this
 * directory and `src/lib/auth.ts` (ADR-0011), and ESLint enforces that.
 */
export { ApiError } from "@schoolhub/api-client";

/**
 * Every domain's API calls, aggregated behind one object. A component imports `Services`
 * and calls `Services.<domain>.<action>(...)` — never `apiClient` and never a service
 * module's file directly — so every call site self-documents which domain it's calling
 * into (see `src/services/endpoints.ts` for the path-centralization half of this
 * convention).
 *
 * Add a domain here the moment its module lands, following the same
 * `services/modules/<domain>/{<domain>-service.ts,index.ts}` shape as `auth`, `tenant`,
 * `dashboard` and `files`.
 */
export const Services = {
  auth: AuthService,
  tenant: TenantService,
  dashboard: DashboardService,
  files: FilesService,
} as const;
