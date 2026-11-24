import type { ApiSchemas } from "@schoolhub/api-client";

/** The platform console's wire shapes, aliased from the generated client (ADR-0017). */

export type TenantRecord = ApiSchemas["Tenant"];
export type TenantStatus = ApiSchemas["TenantStatusEnum"];
export type TenantCreateInput = ApiSchemas["TenantCreate"];
export type TenantUpdateInput = ApiSchemas["PatchedTenantUpdate"];
export type ProvisionInput = ApiSchemas["Provision"];
export type ReasonInput = ApiSchemas["Reason"];
export type ReinstateInput = ApiSchemas["Reinstate"];
export type DeleteTenantInput = ApiSchemas["Delete"];

export type PlanRecord = ApiSchemas["Plan"];
export type PlanInput = ApiSchemas["PlanWrite"];
export type PlanUpdateInput = ApiSchemas["PatchedPlanWrite"];
export type BillingPeriod = ApiSchemas["BillingPeriodEnum"];

export type SubscriptionState = ApiSchemas["SubscriptionState"];
export type SubscriptionRecord = ApiSchemas["Subscription"];
export type SubscriptionStatus = ApiSchemas["SubscriptionStatusEnum"];
export type SubscriptionUpdateInput = ApiSchemas["PatchedSubscriptionUpdate"];
export type ActivateSubscriptionInput = ApiSchemas["SubscriptionActivate"];
export type ChangePlanInput = ApiSchemas["SubscriptionChangePlan"];
export type RecordPaymentInput = ApiSchemas["SubscriptionPayment"];

export type FeatureFlagRecord = ApiSchemas["FeatureFlag"];
export type FeatureFlagUpdateInput = ApiSchemas["PatchedFeatureFlagUpdate"];
export type FeatureOverrideRecord = ApiSchemas["TenantFeatureOverride"];
export type FeatureOverrideInput = ApiSchemas["TenantFeatureOverrideCreate"];

export type TenantUsage = ApiSchemas["TenantUsage"];
export type UsageSnapshot = ApiSchemas["TenantUsageSnapshot"];
export type PlatformJob = ApiSchemas["PlatformJob"];

/** A quota metric's limit: a whole number, or `null` for unlimited. */
export type Limits = Record<string, number | null>;

/** A tenant lifecycle colon-action (`POST /platform/tenants/{id}:<action>`). */
export type TenantAction =
  "provision" | "suspend" | "reinstate" | "delete" | "restore" | "export" | "refresh-usage";

/** A subscription colon-action (`POST .../subscription:<action>`). */
export type SubscriptionAction =
  "activate" | "record-payment" | "mark-payment-failed" | "change-plan";

/** One breach `meta.over_usage` lists on a 409 `limit_below_usage`
 * (`apps/api/apps/platform_admin/usage/limits.py`'s `breaches`). */
export interface OverUsage {
  tenant_id: string;
  metric: string;
  limit: number;
  usage: number;
}

/** `GET /platform/reports/{key}`'s JSON: each section is a list of flat rows. */
export interface PlatformReport {
  key: string;
  title: string;
  generated_at: string;
  sections: Record<string, Record<string, unknown>[]>;
}

/** A page-numbered platform list's query. */
export interface PlatformPageQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  ordering?: string;
}

export interface TenantPageQuery extends PlatformPageQuery {
  status?: TenantStatus;
  currentPlan?: string;
}

export interface PlanPageQuery extends PlatformPageQuery {
  isActive?: boolean;
}

/** `202` from `:export`: the job to poll. */
export interface ExportAccepted {
  jobId: string;
}
