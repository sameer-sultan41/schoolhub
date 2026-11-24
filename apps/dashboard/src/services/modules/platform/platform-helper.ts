import { FILTER_ALL } from "@/lib/constants";
import { PLAN_ACTIVITY, TENANT_STATUSES } from "./platform-constant";
import type {
  Limits,
  OverUsage,
  PlanPageQuery,
  PlatformPageQuery,
  TenantPageQuery,
  TenantStatus,
} from "./platform-type";

/** The platform console's pure helpers: plain data in, plain data out. */

type QueryParams = Record<string, string | number | boolean | undefined>;

function pageParams(query: PlatformPageQuery): QueryParams {
  return {
    page: query.page,
    page_size: query.pageSize,
    search: query.search || undefined,
    ordering: query.ordering,
  };
}

export function toTenantQueryParams(query: TenantPageQuery): QueryParams {
  return {
    ...pageParams(query),
    status: query.status,
    current_plan: query.currentPlan || undefined,
  };
}

export function toPlanQueryParams(query: PlanPageQuery): QueryParams {
  return { ...pageParams(query), is_active: query.isActive };
}

export function toPageParams(query: PlatformPageQuery): QueryParams {
  return pageParams(query);
}

/** The status filter -> `status`: `all` (or an unknown value) is no filter. */
export function statusFilterToStatus(value: string): TenantStatus | undefined {
  if (value === FILTER_ALL) return undefined;
  return (TENANT_STATUSES as readonly string[]).includes(value)
    ? (value as TenantStatus)
    : undefined;
}

/** The plans activity filter -> `is_active`. */
export function activityToIsActive(value: string): boolean | undefined {
  if (value === PLAN_ACTIVITY.active) return true;
  if (value === PLAN_ACTIVITY.retired) return false;
  return undefined;
}

/** `meta.over_usage` from a 409 `limit_below_usage`, keeping only well-formed entries. */
export function readOverUsage(meta: Record<string, unknown>): OverUsage[] {
  const raw = meta["over_usage"];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry: unknown): OverUsage[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const { tenant_id, metric, limit, usage } = entry as Record<string, unknown>;
    if (typeof metric !== "string" || typeof limit !== "number" || typeof usage !== "number") {
      return [];
    }
    return [{ tenant_id: typeof tenant_id === "string" ? tenant_id : "", metric, limit, usage }];
  });
}

/** A limit field's text -> the wire value: blank is unlimited (`null`), else a whole number. */
export function parseLimit(text: string): number | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : Number(trimmed);
}

/** A wire limit -> the field's text: unlimited is blank. */
export function formatLimit(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/** Every metric in `metrics` from its field text. */
export function limitsFromText(metrics: readonly string[], text: Record<string, string>): Limits {
  return Object.fromEntries(metrics.map((metric) => [metric, parseLimit(text[metric] ?? "")]));
}

/** Bytes as GiB with one decimal, the unit `storage_gb` limits are in. */
export function bytesToGib(bytes: number): number {
  return Math.round((bytes / 1024 ** 3) * 10) / 10;
}

/** A `datetime-local` input's value (local wall time) -> an ISO instant, or `null` when blank. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
