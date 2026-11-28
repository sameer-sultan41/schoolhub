import type { PermissionKey } from "@schoolhub/types";

/**
 * The console's permission keys (platform-admin.md §4), each gating exactly the route the API
 * gates on it (the `required_permission_map` of each resource's `viewset.py` under
 * `apps/api/apps/platform_admin`). UX only: the API enforces. None of them is a key a school
 * role holds; a school's own `platform.*` keys (`platform.file.*`, `platform.job.view`,
 * `platform.notification.view`) gate nothing here.
 */
export const PLATFORM_KEYS = {
  tenantView: "platform.tenant.view",
  /** Creating a school is part of provisioning: `POST /platform/tenants` needs this key. */
  tenantProvision: "platform.tenant.provision",
  tenantUpdate: "platform.tenant.update",
  tenantSuspend: "platform.tenant.suspend",
  tenantReinstate: "platform.tenant.reinstate",
  tenantExport: "platform.tenant.export",
  /** `:delete`, and `:restore` too: undoing a deprovision is the deleting authority's call. */
  tenantDelete: "platform.tenant.delete",
  planView: "platform.plan.view",
  planCreate: "platform.plan.create",
  planUpdate: "platform.plan.update",
  planDelete: "platform.plan.delete",
  subscriptionView: "platform.subscription.view",
  subscriptionUpdate: "platform.subscription.update",
  flagView: "platform.feature-flag.view",
  /** A flag's platform default and kill switch, and every school's overrides. */
  flagUpdate: "platform.feature-flag.update",
  reportView: "platform.report.view",
} as const satisfies Record<string, PermissionKey>;
