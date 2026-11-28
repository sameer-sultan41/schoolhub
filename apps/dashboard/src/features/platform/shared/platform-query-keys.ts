import { queryKeys } from "@/lib/query-client";
import {
  PLATFORM_QUERY_MODULE,
  TENANT_DETAIL_RESOURCE,
} from "@/services/modules/platform/platform-constant";

/** The query key of one school's record in the console: its page, and any dialog naming it. */
export function tenantDetailKey(tenantId: string) {
  return queryKeys.detail(PLATFORM_QUERY_MODULE, TENANT_DETAIL_RESOURCE, tenantId);
}
