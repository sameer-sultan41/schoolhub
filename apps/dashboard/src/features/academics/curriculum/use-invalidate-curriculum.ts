"use client";

import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { CURRICULUM_QUERY_MODULE } from "@/services/modules/curriculum/curriculum-constant";
import {
  ALLOCATION_LOAD_SUMMARY_RESOURCE,
  ALLOCATION_QUERY_MODULE,
} from "@/services/modules/teacher-allocations/teacher-allocations-constant";

/**
 * After a curriculum write: refresh `curriculum`, and the allocations load summary, whose
 * periods for an allocation with no override of its own come from the curriculum. The load
 * summary is invalidated by its `[module, resource]` prefix, so every session's entry goes.
 */
export function useInvalidateCurriculum() {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.module(CURRICULUM_QUERY_MODULE) });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.list(ALLOCATION_QUERY_MODULE, ALLOCATION_LOAD_SUMMARY_RESOURCE),
    });
  };
}
