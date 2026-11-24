import { ApiError } from "@schoolhub/api-client";
import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";

import type { PlanRecord, TenantRecord } from "@/services/modules/platform/platform-type";
import { buildUser } from "@/test-utils";

/** The platform console's tests' records, shaped like the generated wire types. */

export const TENANT_ID = "6f1d3c2b-8a4e-4f5d-9c7b-1a2b3c4d5e6f";
export const PLAN_ID = "0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";

export function tenantRecord(overrides: Partial<TenantRecord> = {}): TenantRecord {
  return {
    id: TENANT_ID,
    name: "City School",
    slug: "city-school",
    status: "trial",
    contact_name: "Ayesha Khan",
    contact_email: "owner@cityschool.test",
    contact_phone: "",
    timezone: "Asia/Karachi",
    locale: "en",
    currency: "PKR",
    trial_ends_at: "2026-12-08T00:00:00Z",
    provisioned_at: "2026-11-24T09:00:00Z",
    suspended_at: null,
    deprovision_after: null,
    current_plan: "",
    subscription_status: "",
    created_at: "2026-11-24T08:00:00Z",
    updated_at: "2026-11-24T09:00:00Z",
    ...overrides,
  };
}

export function planRecord(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: PLAN_ID,
    name: "Standard",
    code: "standard",
    description: "",
    price_amount: "15000.00",
    currency: "PKR",
    billing_period: "monthly",
    trial_days: 14,
    enabled_modules: ["module.students", "module.staff"],
    limits: { students: 500, staff: 60, storage_gb: 20, sms_credits: null, ai_tokens: null },
    is_active: true,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}

/** A platform operator holding exactly `permissions`. */
export function platformUser(permissions: PermissionKey[]): AuthenticatedUser {
  return {
    ...buildUser(permissions),
    tenant_id: "",
    tenant_summary: null,
    is_platform: true,
    mfa_enabled: true,
  };
}

/** The server's error envelope as the client surfaces it (`apps/api/core/api/exceptions.py`). */
export function apiError(
  status: number,
  code: string,
  message: string,
  extra: { meta?: Record<string, unknown>; details?: { field: string; issue: string }[] } = {},
): ApiError {
  return new ApiError({
    code,
    message,
    status,
    url: "/platform",
    details: extra.details ?? [],
    meta: extra.meta,
  });
}
