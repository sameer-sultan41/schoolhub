"use client";

import { hashKey, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services, type ExamConflict } from "@/services";
import {
  EXAM_SCHEDULES_QUERY_MODULE,
  SCHEDULE_CONFLICTS_RESOURCE,
} from "@/services/modules/exam-schedules/exam-schedules-constant";

/** The cache key of one exam's clash list: the tab reads it, and writes that answer with the
 * list put it here. */
export function scheduleConflictsKey(examId: string) {
  return queryKeys.list(EXAM_SCHEDULES_QUERY_MODULE, SCHEDULE_CONFLICTS_RESOURCE, { examId });
}

/** One exam's clash list on a fresh read, hard findings first. */
export function useScheduleConflicts(examId: string) {
  return useQuery({
    queryKey: scheduleConflictsKey(examId),
    queryFn: () => Services.examSchedules.fetchConflicts(examId),
  });
}

/**
 * For a sitting write that answered with the exam's whole clash list (`meta.conflicts`): puts the
 * list in the cache (TanStack's "updates from mutation responses") and stales the module's other
 * reads, so the list is not fetched a second time. Other exams' lists are still staled: a room
 * clash shows on both exams.
 */
export function useApplySittingWrite(examId: string) {
  const queryClient = useQueryClient();

  return (conflicts: ExamConflict[]) => {
    const key = scheduleConflictsKey(examId);
    const keyHash = hashKey(key);
    queryClient.setQueryData(key, conflicts);
    void queryClient.invalidateQueries({
      queryKey: queryKeys.module(EXAM_SCHEDULES_QUERY_MODULE),
      predicate: (query) => query.queryHash !== keyHash,
    });
  };
}
