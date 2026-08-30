import type { Tenant } from "@schoolhub/types";
import { buildTenant } from "@/data/factories";
import { ok } from "../envelope";
import type { MockModule } from "../router";

/**
 * `/tenant` — the current tenant's identity and branding.
 *
 * `AppShell` fetches this on every authenticated page to project branding into CSS
 * custom properties, so almost every dashboard spec needs it stubbed.
 */
export function tenantModule(tenant: Tenant = buildTenant()): MockModule {
  return (api) => {
    api.get("/tenant", () => ok(tenant));
  };
}
