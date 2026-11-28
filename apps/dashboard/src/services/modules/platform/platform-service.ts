import { fetchPage, MAX_PAGE_SIZE, type Page } from "@schoolhub/api-client";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toPageParams, toPlanQueryParams, toTenantQueryParams } from "./platform-helper";
import type {
  ActivateSubscriptionInput,
  ChangePlanInput,
  DeleteTenantInput,
  ExportAccepted,
  ExportDownload,
  FeatureFlagRecord,
  FeatureFlagUpdateInput,
  FeatureOverrideInput,
  FeatureOverrideRecord,
  PlanInput,
  PlanPageQuery,
  PlanRecord,
  PlanUpdateInput,
  PlatformJob,
  PlatformPageQuery,
  PlatformReport,
  ProvisionInput,
  ReasonInput,
  RecordPaymentInput,
  ReinstateInput,
  SubscriptionState,
  SubscriptionUpdateInput,
  TenantCreateInput,
  TenantPageQuery,
  TenantRecord,
  TenantUpdateInput,
  TenantUsage,
} from "./platform-type";

/**
 * The platform console's API calls (`/platform/*`, platform-admin.md §16). Every lifecycle and
 * subscription colon-action takes the dialog's `Idempotency-Key`: the server replays a success
 * for a repeated key and runs a refused attempt again.
 */

export interface ActionOptions {
  idempotencyKey: string;
}

// --- Tenants ---------------------------------------------------------------------------------

export async function fetchTenantPage(query: TenantPageQuery): Promise<Page<TenantRecord>> {
  return fetchPage<TenantRecord>(apiClient, endpoints.platform.tenants, {
    query: toTenantQueryParams(query),
  });
}

export async function fetchTenant(id: string): Promise<TenantRecord> {
  const { data } = await apiClient.get<TenantRecord>(endpoints.platform.tenant(id));
  return data;
}

export async function createTenant(input: TenantCreateInput): Promise<TenantRecord> {
  const { data } = await apiClient.post<TenantRecord>(endpoints.platform.tenants, input);
  return data;
}

export async function updateTenant(id: string, input: TenantUpdateInput): Promise<TenantRecord> {
  const { data } = await apiClient.patch<TenantRecord>(endpoints.platform.tenant(id), input);
  return data;
}

async function tenantAction(
  id: string,
  action: "provision" | "suspend" | "reinstate" | "delete" | "restore",
  body: object,
  options: ActionOptions,
): Promise<TenantRecord> {
  const { data } = await apiClient.post<TenantRecord>(
    endpoints.platform.tenantAction(id, action),
    body,
    { idempotencyKey: options.idempotencyKey },
  );
  return data;
}

export function provisionTenant(id: string, input: ProvisionInput, options: ActionOptions) {
  return tenantAction(id, "provision", input, options);
}

export function suspendTenant(id: string, input: ReasonInput, options: ActionOptions) {
  return tenantAction(id, "suspend", input, options);
}

export function reinstateTenant(id: string, input: ReinstateInput, options: ActionOptions) {
  return tenantAction(id, "reinstate", input, options);
}

export function deleteTenant(id: string, input: DeleteTenantInput, options: ActionOptions) {
  return tenantAction(id, "delete", input, options);
}

export function restoreTenant(id: string, input: ReasonInput, options: ActionOptions) {
  return tenantAction(id, "restore", input, options);
}

/** Starts (or rejoins) the school's export job; `202 {job_id, status}`. */
export async function exportTenant(id: string, options: ActionOptions): Promise<ExportAccepted> {
  const { data } = await apiClient.post<ExportAccepted>(
    endpoints.platform.tenantAction(id, "export"),
    undefined,
    { idempotencyKey: options.idempotencyKey },
  );
  return data;
}

/** Polls one of the school's platform jobs. The answer carries no link. */
export async function fetchTenantJob(tenantId: string, jobId: string): Promise<PlatformJob> {
  const { data } = await apiClient.get<PlatformJob>(endpoints.platform.tenantJob(tenantId, jobId));
  return data;
}

/**
 * A fresh signed link to a succeeded export, audited per call on the server. 409 `conflict`
 * until the job has succeeded.
 */
export async function downloadTenantExport(
  tenantId: string,
  jobId: string,
): Promise<ExportDownload> {
  const { data } = await apiClient.post<ExportDownload>(
    endpoints.platform.tenantJobDownload(tenantId, jobId),
  );
  return data;
}

export async function fetchTenantUsage(id: string): Promise<TenantUsage> {
  const { data } = await apiClient.get<TenantUsage>(endpoints.platform.tenantUsage(id));
  return data;
}

/** Takes a usage snapshot now and returns it. */
export async function refreshTenantUsage(id: string): Promise<TenantUsage> {
  const { data } = await apiClient.post<TenantUsage>(
    endpoints.platform.tenantAction(id, "refresh-usage"),
  );
  return data;
}

// --- Subscription ----------------------------------------------------------------------------

export async function fetchSubscription(tenantId: string): Promise<SubscriptionState> {
  const { data } = await apiClient.get<SubscriptionState>(
    endpoints.platform.subscription(tenantId),
  );
  return data;
}

export async function updateSubscription(
  tenantId: string,
  input: SubscriptionUpdateInput,
): Promise<SubscriptionState> {
  const { data } = await apiClient.patch<SubscriptionState>(
    endpoints.platform.subscription(tenantId),
    input,
  );
  return data;
}

async function subscriptionAction(
  tenantId: string,
  action: "activate" | "record-payment" | "mark-payment-failed" | "change-plan",
  body: object | undefined,
  options: ActionOptions,
): Promise<SubscriptionState> {
  const { data } = await apiClient.post<SubscriptionState>(
    endpoints.platform.subscriptionAction(tenantId, action),
    body,
    { idempotencyKey: options.idempotencyKey },
  );
  return data;
}

export function activateSubscription(
  tenantId: string,
  input: ActivateSubscriptionInput,
  options: ActionOptions,
) {
  return subscriptionAction(tenantId, "activate", input, options);
}

export function recordPayment(tenantId: string, input: RecordPaymentInput, options: ActionOptions) {
  return subscriptionAction(tenantId, "record-payment", input, options);
}

export function markPaymentFailed(tenantId: string, options: ActionOptions) {
  return subscriptionAction(tenantId, "mark-payment-failed", undefined, options);
}

export function changePlan(tenantId: string, input: ChangePlanInput, options: ActionOptions) {
  return subscriptionAction(tenantId, "change-plan", input, options);
}

// --- Feature overrides -----------------------------------------------------------------------

/** Not paginated: a school's overrides are a short list. */
export async function fetchOverrides(tenantId: string): Promise<FeatureOverrideRecord[]> {
  const { data } = await apiClient.get<FeatureOverrideRecord[]>(
    endpoints.platform.overrides(tenantId),
  );
  return data;
}

export async function createOverride(
  tenantId: string,
  input: FeatureOverrideInput,
): Promise<FeatureOverrideRecord> {
  const { data } = await apiClient.post<FeatureOverrideRecord>(
    endpoints.platform.overrides(tenantId),
    input,
  );
  return data;
}

export async function deleteOverride(tenantId: string, overrideId: string): Promise<void> {
  await apiClient.delete(endpoints.platform.override(tenantId, overrideId));
}

// --- Plans -----------------------------------------------------------------------------------

export async function fetchPlanPage(query: PlanPageQuery): Promise<Page<PlanRecord>> {
  return fetchPage<PlanRecord>(apiClient, endpoints.platform.plans, {
    query: toPlanQueryParams(query),
  });
}

/** The active plans a school can trial on or move to, for a picker (one full page). */
export async function fetchActivePlans(): Promise<PlanRecord[]> {
  const page = await fetchPage<PlanRecord>(apiClient, endpoints.platform.plans, {
    query: { is_active: true, ordering: "name", page_size: MAX_PAGE_SIZE },
  });
  return page.items;
}

export async function createPlan(input: PlanInput): Promise<PlanRecord> {
  const { data } = await apiClient.post<PlanRecord>(endpoints.platform.plans, input);
  return data;
}

export async function updatePlan(id: string, input: PlanUpdateInput): Promise<PlanRecord> {
  const { data } = await apiClient.patch<PlanRecord>(endpoints.platform.plan(id), input);
  return data;
}

/** Soft-deletes the plan; a plan a school is on is a 409 `plan_in_use`. */
export async function retirePlan(id: string): Promise<void> {
  await apiClient.delete(endpoints.platform.plan(id));
}

// --- Feature flags ---------------------------------------------------------------------------

export async function fetchFlagPage(query: PlatformPageQuery): Promise<Page<FeatureFlagRecord>> {
  return fetchPage<FeatureFlagRecord>(apiClient, endpoints.platform.featureFlags, {
    query: toPageParams(query),
  });
}

/** Every flag, for a plan's module picker and an override's flag picker (one full page). */
export async function fetchAllFlags(): Promise<FeatureFlagRecord[]> {
  const page = await fetchPage<FeatureFlagRecord>(apiClient, endpoints.platform.featureFlags, {
    query: { ordering: "key", page_size: MAX_PAGE_SIZE },
  });
  return page.items;
}

export async function updateFlag(
  id: string,
  input: FeatureFlagUpdateInput,
): Promise<FeatureFlagRecord> {
  const { data } = await apiClient.patch<FeatureFlagRecord>(
    endpoints.platform.featureFlag(id),
    input,
  );
  return data;
}

// --- Reports ---------------------------------------------------------------------------------

export async function fetchReport(key: string): Promise<PlatformReport> {
  // JSON is the default format; only the file formats are asked for by name.
  const { data } = await apiClient.get<PlatformReport>(endpoints.platform.report(key));
  return data;
}

/** The report as a CSV attachment, streamed with the bearer token. */
export async function downloadReport(key: string): Promise<Blob> {
  return apiClient.downloadBlob(endpoints.platform.report(key), { query: { format: "csv" } });
}
