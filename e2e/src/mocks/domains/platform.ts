import type { ApiSchemas } from "@schoolhub/api-client";
import { fail, noContent, ok } from "../envelope";
import { pageOf } from "../list";
import type { MockModule, MockRequest } from "../router";
import { colonAction } from "./attendance-mock-utils";
import { grantStarted } from "./impersonation";

type Tenant = ApiSchemas["Tenant"];
type TenantStatus = Tenant["status"];

export interface PlatformModuleOptions {
  tenants?: Tenant[];
  /** The users `GET /platform/tenants/{id}/users` lists, whom `:impersonate` accepts. */
  users?: ApiSchemas["PlatformTenantUser"][];
}

const NOW = "2026-11-24T09:00:00Z";
const TRIAL_END = "2026-12-08T09:00:00Z";

/** A school as `POST /platform/tenants` returns it: provisioning, no plan, no dates. */
export function buildTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: crypto.randomUUID(),
    name: "Existing School",
    slug: "existing-school",
    status: "active",
    contact_name: "Bilal Ahmed",
    contact_email: "owner@existing.test",
    contact_phone: "",
    timezone: "Asia/Karachi",
    locale: "en",
    currency: "PKR",
    trial_ends_at: null,
    provisioned_at: NOW,
    suspended_at: null,
    deprovision_after: null,
    current_plan: "",
    subscription_status: "",
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

/** The edges `apps/api/apps/platform_admin/tenants/lifecycle.py` allows, for the actions this
 * mock models; any other is the server's 409 `invalid_transition`. */
const EDGES: Record<string, { from: readonly TenantStatus[]; to: TenantStatus }> = {
  provision: { from: ["provisioning"], to: "trial" },
  suspend: { from: ["trial", "active", "past_due"], to: "suspended" },
};

function invalidTransition() {
  return fail(409, "This school's status does not allow that action.", {
    code: "invalid_transition",
  });
}

function blankReason(request: MockRequest) {
  const body = request.json() as { reason?: string } | null;
  return !body?.reason?.trim();
}

/**
 * `/platform/*` — the tenants list, create, detail, `:provision` and `:suspend`, plus the empty
 * reads a tenant's detail tabs make (subscription, usage, overrides, plans, flags). A stateful
 * stub: a created school shows in the list, and a lifecycle action moves its status.
 */
export function platformModule(options: PlatformModuleOptions = {}): MockModule {
  return (api) => {
    const tenants = [...(options.tenants ?? [])];
    const users = options.users ?? [];

    api.get("/platform/tenants/:tenantId/users", (request) => {
      const q = request.searchParams.get("q")?.toLowerCase() ?? "";
      const role = request.searchParams.get("role");
      const matching = users.filter(
        (user) =>
          (!q || `${user.name} ${user.email}`.toLowerCase().includes(q)) &&
          (!role || user.roles.includes(role)),
      );
      return pageOf(matching, request.searchParams);
    });

    api.get("/platform/tenants", (request) => {
      const search = request.searchParams.get("search")?.toLowerCase() ?? "";
      const status = request.searchParams.get("status");
      const matching = tenants.filter(
        (tenant) =>
          (!search || `${tenant.name} ${tenant.slug}`.toLowerCase().includes(search)) &&
          (!status || tenant.status === status),
      );
      return pageOf(matching, request.searchParams);
    });

    api.post("/platform/tenants", (request) => {
      const body = request.json() as ApiSchemas["TenantCreate"];
      if (tenants.some((tenant) => tenant.slug === body.slug)) {
        return fail(400, "Invalid input.", {
          details: [{ field: "slug", issue: "A school with this slug already exists." }],
        });
      }
      const tenant = buildTenant({
        ...body,
        contact_phone: body.contact_phone ?? "",
        status: "provisioning",
        provisioned_at: null,
      });
      tenants.push(tenant);
      return ok(tenant, { status: 201 });
    });

    api.get("/platform/tenants/:tenantId", (request) => {
      const tenant = tenants.find((candidate) => candidate.id === request.params["tenantId"]);
      return tenant ? ok(tenant) : fail(404, "Not found.");
    });

    // Colon-actions arrive as one segment, `<id>:<action>` (see `colonAction`).
    api.post("/platform/tenants/:target", (request) => {
      const { id, action } = colonAction(request.params["target"]);
      const index = tenants.findIndex((candidate) => candidate.id === id);
      const tenant = tenants[index];
      if (tenant && action === "impersonate") {
        const body = request.json() as ApiSchemas["ImpersonateRequest"] | null;
        if (!users.some((user) => user.id === body?.user_id)) {
          return fail(422, "The user is not an active user of this school.", {
            code: "domain_rule_violation",
          });
        }
        return ok(grantStarted(tenant.slug), { status: 201 });
      }
      const edge = action ? EDGES[action] : undefined;
      if (!tenant || !edge) return fail(404, "Not found.");
      if (action === "suspend" && blankReason(request)) {
        return fail(400, "Invalid input.", {
          details: [{ field: "reason", issue: "This field may not be blank." }],
        });
      }
      if (!edge.from.includes(tenant.status)) return invalidTransition();
      const moved: Tenant = {
        ...tenant,
        status: edge.to,
        ...(action === "provision" ? { trial_ends_at: TRIAL_END, provisioned_at: NOW } : {}),
        ...(action === "suspend" ? { suspended_at: NOW } : {}),
      };
      tenants[index] = moved;
      return ok(moved);
    });

    api.get("/platform/tenants/:tenantId/subscription", (request) => {
      const tenant = tenants.find((candidate) => candidate.id === request.params["tenantId"]);
      if (!tenant) return fail(404, "Not found.");
      return ok<ApiSchemas["SubscriptionState"]>({
        tenant_status: tenant.status,
        trial_ends_at: tenant.trial_ends_at,
        subscription: null,
        limits: {
          students: null,
          staff: null,
          storage_gb: null,
          sms_credits: null,
          ai_tokens: null,
        },
      });
    });

    api.get("/platform/tenants/:tenantId/usage", () =>
      ok<ApiSchemas["TenantUsage"]>({
        snapshot: null,
        limits: {
          students: null,
          staff: null,
          storage_gb: null,
          sms_credits: null,
          ai_tokens: null,
        },
      }),
    );

    api.get("/platform/tenants/:tenantId/feature-overrides", () =>
      ok<ApiSchemas["TenantFeatureOverride"][]>([]),
    );

    api.get("/platform/plans", (request) => pageOf([], request.searchParams));
    api.get("/platform/feature-flags", (request) => pageOf([], request.searchParams));
    api.delete("/platform/tenants/:tenantId/feature-overrides/:overrideId", () => noContent());
  };
}
