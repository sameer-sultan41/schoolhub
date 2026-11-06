"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { PARENT_PORTAL_QUERY_MODULE } from "@/services/modules/parent-portal/parent-portal-constant";
import { fetchAllPages } from "@/features/portal/fetch-all-pages";

const ISO = "yyyy-MM-dd";

/** One child's attendance rows over `range` (inclusive); nothing is asked until it is known. */
export function useRangeAttendance(
  studentId: string | undefined,
  range: { from: Date; to: Date } | undefined,
) {
  const dateFrom = range && format(range.from, ISO);
  const dateTo = range && format(range.to, ISO);
  return useQuery({
    queryKey: queryKeys.list(PARENT_PORTAL_QUERY_MODULE, "attendance", {
      studentId,
      dateFrom,
      dateTo,
    }),
    enabled: studentId !== undefined && range !== undefined,
    queryFn: () =>
      fetchAllPages((cursor) =>
        Services.studentAttendance.fetchAttendancePage({
          studentId,
          dateFrom,
          dateTo,
          pageSize: 100,
          cursor,
        }),
      ),
  });
}
