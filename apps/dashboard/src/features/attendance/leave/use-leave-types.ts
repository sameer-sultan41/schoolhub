"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  LEAVE_TYPES_LIST_RESOURCE,
  LEAVE_TYPES_QUERY_MODULE,
} from "@/services/modules/leave-requests/leave-requests-constant";
import { toLeaveTypeOptions } from "@/services/modules/leave-requests/leave-requests-helper";

/** The leave types a student request can name, for the queue's type filter. */
export function useLeaveTypes() {
  return useQuery({
    queryKey: queryKeys.list(LEAVE_TYPES_QUERY_MODULE, LEAVE_TYPES_LIST_RESOURCE),
    queryFn: () => Services.leaveRequests.fetchLeaveTypes(),
    select: toLeaveTypeOptions,
  });
}
