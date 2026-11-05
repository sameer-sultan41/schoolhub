"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { PARENT_PORTAL_QUERY_MODULE } from "@/services/modules/parent-portal/parent-portal-constant";
import { fetchAllPages } from "@/features/portal/fetch-all-pages";

const ISO = "yyyy-MM-dd";

/** One child's attendance rows between `from` and `to` (inclusive). */
export function useRangeAttendance(studentId: string | undefined, from: Date, to: Date) {
  const dateFrom = format(from, ISO);
  const dateTo = format(to, ISO);
  return useQuery({
    queryKey: queryKeys.list(PARENT_PORTAL_QUERY_MODULE, "attendance", {
      studentId,
      dateFrom,
      dateTo,
    }),
    enabled: studentId !== undefined,
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
