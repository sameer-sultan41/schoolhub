"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  EXAM_SCHEDULES_QUERY_MODULE,
  SITTINGS_LIST_RESOURCE,
} from "@/services/modules/exam-schedules/exam-schedules-constant";

/** One exam's whole sitting list, under the key the Schedule tab reads it with: one cache entry,
 * so the Admit cards tab's section filter adds no request once that tab has loaded.
 * `/exam-schedules` needs `exams.schedule.view`: pass `enabled: false` when the viewer lacks it. */
export function useExamSittings(examId: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.list(EXAM_SCHEDULES_QUERY_MODULE, SITTINGS_LIST_RESOURCE, { examId }),
    queryFn: () => Services.examSchedules.fetchSittings(examId),
    enabled,
  });
}
