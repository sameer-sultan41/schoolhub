"use client";

import { useQuery } from "@tanstack/react-query";

import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  FLAG_LIST_RESOURCE,
  PLAN_LIST_RESOURCE,
  PLATFORM_QUERY_MODULE,
} from "@/services/modules/platform/platform-constant";
import { PLATFORM_KEYS } from "@/features/platform/platform-permissions";

/**
 * The pickers' reference lists, one cache entry each under the platform module, so any console
 * write refreshes them. Each is read only by a viewer holding its view key: without it the
 * picker offers no options rather than a 403.
 */

/** The active plans a school can trial on or move to. */
export function useActivePlans() {
  const { data: user } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.list(PLATFORM_QUERY_MODULE, PLAN_LIST_RESOURCE, { picker: "active" }),
    queryFn: () => Services.platform.fetchActivePlans(),
    enabled: hasPermission(user, PLATFORM_KEYS.planView),
  });
}

/** Every feature flag: a plan's modules, an override's flag. */
export function useAllFlags() {
  const { data: user } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.list(PLATFORM_QUERY_MODULE, FLAG_LIST_RESOURCE, { picker: "all" }),
    queryFn: () => Services.platform.fetchAllFlags(),
    enabled: hasPermission(user, PLATFORM_KEYS.flagView),
  });
}
