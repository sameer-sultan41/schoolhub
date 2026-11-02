"use client";

import { useQuery } from "@tanstack/react-query";

import { useCampuses } from "@/hooks/use-reference-data";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { BROADCASTS_QUERY_MODULE } from "@/services/modules/broadcasts/broadcasts-constant";
import { campusesInScope } from "@/services/modules/broadcasts/broadcasts-helper";

interface Option {
  id: string;
  name: string;
}

export interface BroadcastCampuses {
  /** `pending` until the scope (and, for a restricted sender, the campuses) has loaded. */
  status: "pending" | "error" | "ready";
  /** A campus-restricted sender must pick a campus, and only one of `options`. */
  requireCampus: boolean;
  /** What the campus picker offers: every campus, or a restricted sender's own. */
  options: readonly Option[];
  /** A restricted sender whose scope reaches no campus that exists: they cannot send. */
  reachesNoCampus: boolean;
  /** Reloads whichever read failed. */
  retry: () => void;
}

/**
 * The campuses a sender may broadcast to, read from `GET /broadcasts:scope` (the rule the send
 * enforces) so a restricted sender is never offered a campus the server would refuse.
 */
export function useBroadcastCampuses(): BroadcastCampuses {
  const scope = useQuery({
    queryKey: queryKeys.list(BROADCASTS_QUERY_MODULE, "scope"),
    queryFn: () => Services.broadcasts.fetchScope(),
  });
  const campuses = useCampuses();
  const retry = () => {
    if (scope.isError) void scope.refetch();
    if (campuses.isError) void campuses.refetch();
  };
  const result = (
    status: BroadcastCampuses["status"],
    requireCampus: boolean,
    options: readonly Option[] = [],
  ): BroadcastCampuses => ({
    status,
    requireCampus,
    options,
    reachesNoCampus: status === "ready" && requireCampus && options.length === 0,
    retry,
  });

  if (scope.isPending) return result("pending", false);
  if (scope.isError) return result("error", false);

  const campusIds = scope.data.campus_ids;
  // Unrestricted: any campus or none, as before the scope existed.
  if (campusIds === null) return result("ready", false, campuses.data ?? []);
  if (campusIds.length === 0) return result("ready", true);
  if (campuses.isPending) return result("pending", true);
  if (campuses.isError) return result("error", true);
  return result("ready", true, campusesInScope(campuses.data, campusIds));
}
