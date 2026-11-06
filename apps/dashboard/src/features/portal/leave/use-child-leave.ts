"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { PARENT_PORTAL_QUERY_MODULE } from "@/services/modules/parent-portal/parent-portal-constant";
import { fetchAllPages } from "@/features/portal/fetch-all-pages";

const PAGE_SIZE = 100;

export const PORTAL_LEAVE_RESOURCE = "leave";

/** One child's leave requests, newest first. The server limits a guardian to their own
 * children, so a foreign `studentId` would come back empty, never someone else's rows. */
export function useChildLeave(studentId: string) {
  return useQuery({
    queryKey: queryKeys.list(PARENT_PORTAL_QUERY_MODULE, PORTAL_LEAVE_RESOURCE, { studentId }),
    queryFn: () =>
      fetchAllPages((cursor) =>
        Services.leaveRequests.fetchLeavePage({
          studentId,
          cursor,
          pageSize: PAGE_SIZE,
          ordering: "-created_at",
        }),
      ),
  });
}
