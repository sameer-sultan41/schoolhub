import { AuthService } from "./modules/auth";
import { DashboardService } from "./modules/dashboard";
import { FilesService } from "./modules/files";
import { GuardiansService } from "./modules/guardians";
import { JobsService } from "./modules/jobs";
import { SchoolOrganizationService } from "./modules/school-organization";
import { StaffService } from "./modules/staff";
import { StudentsService } from "./modules/students";
import { TenantService } from "./modules/tenant";

/**
 * `ApiError` is re-exported so feature code can `instanceof`-check API failures without
 * importing `@schoolhub/api-client`. Only the transport layer — this directory and
 * `src/lib/` (the session wiring in `auth.ts`, the query client) — imports the client
 * package; everything else goes through `@/services` (ADR-0011). ESLint enforces that
 * boundary via `TRANSPORT` in `apps/dashboard/eslint.config.mjs`.
 */
export { ApiError } from "@schoolhub/api-client";

export type { StudentRecord } from "./modules/students";

/** `UpdateGuardianLinkInput` is re-exported here (not just from the guardians module
 * itself) because Task 7's `GuardianLinkFlagsDialog` imports it from `@/services`, not
 * from the guardians module directly (ADR-0011: feature code imports only `@/services`,
 * never a service module's own path). */
export type {
  GuardianLinkRecord,
  GuardianRecord,
  GuardianRelationship,
  UpdateGuardianLinkInput,
} from "./modules/guardians";

/**
 * Every domain's API calls, aggregated behind one object. A component imports `Services`
 * and calls `Services.<domain>.<action>(...)` — never `apiClient` and never a service
 * module's file directly — so every call site self-documents which domain it's calling
 * into (see `src/services/endpoints.ts` for the path-centralization half of this
 * convention).
 *
 * Add a domain here the moment its module lands, following the five-file
 * `services/modules/<domain>/` shape (ADR-0019) — see `students`/`staff`/`auth`.
 */
export const Services = {
  auth: AuthService,
  tenant: TenantService,
  dashboard: DashboardService,
  files: FilesService,
  jobs: JobsService,
  schoolOrganization: SchoolOrganizationService,
  guardians: GuardiansService,
  staff: StaffService,
  students: StudentsService,
} as const;
