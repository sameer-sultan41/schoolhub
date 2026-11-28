import { FILTER_ALL } from "@/lib/constants";
import type { BillingPeriod, SubscriptionStatus, TenantStatus } from "./platform-type";

/** The query-key module every platform console read lives under, so one write refreshes the
 * console's lists and a tenant's detail tabs together. */
export const PLATFORM_QUERY_MODULE = "platform";

export const TENANT_LIST_RESOURCE = "tenants";
export const TENANT_DETAIL_RESOURCE = "tenant";
export const PLAN_LIST_RESOURCE = "plans";
export const FLAG_LIST_RESOURCE = "feature-flags";
export const REPORT_RESOURCE = "report";

/** Mirrors `TenantStatusEnum` (the generated contract), in lifecycle order. */
export const TENANT_STATUSES = [
  "provisioning",
  "trial",
  "active",
  "past_due",
  "suspended",
  "deprovisioned",
] as const satisfies readonly TenantStatus[];

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
] as const satisfies readonly SubscriptionStatus[];

export const BILLING_PERIODS = ["monthly", "annual"] as const satisfies readonly BillingPeriod[];

/** `QUOTA_METRICS` (`apps/api/apps/platform_admin/constants.py`): the keys a plan's `limits`
 * may carry. Only the first three are enforced in v1; the others are recorded. */
export const QUOTA_METRICS = [
  "students",
  "staff",
  "storage_gb",
  "sms_credits",
  "ai_tokens",
] as const;
export type QuotaMetric = (typeof QUOTA_METRICS)[number];

/** `REPORTS` (`apps/api/apps/platform_admin/reports/registry.py`). */
export const REPORT_KEYS = ["tenant-overview", "revenue", "usage"] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

/** The tenants list's sortable columns -> the API's `ordering` fields. */
export const TENANT_SORT_FIELD = {
  name: "name",
  status: "status",
  created: "created_at",
} as const;
export const TENANT_SORTABLE_IDS = Object.keys(TENANT_SORT_FIELD);
export const TENANT_DEFAULT_SORTING = [{ id: "name", desc: false }];

const TENANT_STATUS_VALUES: readonly string[] = TENANT_STATUSES;
export const TENANT_URL_FILTERS = {
  status: {
    default: FILTER_ALL,
    isValid: (value: string) => value === FILTER_ALL || TENANT_STATUS_VALUES.includes(value),
  },
};

export const PLAN_SORT_FIELD = { name: "name", code: "code", price: "price_amount" } as const;
export const PLAN_SORTABLE_IDS = Object.keys(PLAN_SORT_FIELD);
export const PLAN_DEFAULT_SORTING = [{ id: "name", desc: false }];

/** The plans list's activity filter. */
export const PLAN_ACTIVITY = { all: FILTER_ALL, active: "active", retired: "retired" } as const;
const PLAN_ACTIVITY_VALUES: readonly string[] = Object.values(PLAN_ACTIVITY);
export const PLAN_URL_FILTERS = {
  activity: {
    default: PLAN_ACTIVITY.active,
    isValid: (value: string) => PLAN_ACTIVITY_VALUES.includes(value),
  },
};

export const FLAG_SORT_FIELD = { key: "key" } as const;
export const FLAG_SORTABLE_IDS = Object.keys(FLAG_SORT_FIELD);
export const FLAG_DEFAULT_SORTING = [{ id: "key", desc: false }];
export const FLAG_URL_FILTERS = {};

/** The actions column's id, hidden when the viewer may take no action. */
export const PLATFORM_ACTIONS_COLUMN_ID = "actions";

/** How often an export job is polled, and for how long, before the dialog says it is still
 * running (the job keeps going; the operator can check again). */
export const EXPORT_POLL_INTERVAL_MS = 2000;
export const EXPORT_POLL_TIMEOUT_MS = 120_000;
