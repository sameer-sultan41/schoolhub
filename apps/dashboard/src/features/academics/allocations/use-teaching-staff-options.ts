"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  STAFF_QUERY_MODULE,
  TEACHING_OPTIONS_RESOURCE,
} from "@/services/modules/staff/staff-constant";
import { toStaffOptions } from "@/services/modules/staff/staff-helper";

/** The active teachers a picker offers; the form and the filter share one cache entry. */
export function useTeachingStaffOptions() {
  return useQuery({
    queryKey: queryKeys.list(STAFF_QUERY_MODULE, TEACHING_OPTIONS_RESOURCE),
    queryFn: () => Services.staff.fetchTeachingStaffOptions(),
    select: toStaffOptions,
  });
}
