import type { QueryParams } from "@schoolhub/api-client";

import type { SeoTarget } from "./seo-settings-type";

/** The target as the endpoint's query string; the site row sends no `target_id`. */
export function toSeoTargetParams(target: SeoTarget): QueryParams {
  const params: QueryParams = { target_type: target.targetType };
  if (target.targetId) params.target_id = target.targetId;
  return params;
}

/** One target's cache id: its type, and its record's id when it has one. */
export function seoTargetKey(target: SeoTarget): string {
  return target.targetId ? `${target.targetType}:${target.targetId}` : target.targetType;
}
