"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  GRADING_SCALES_OPTIONS_PAGE_SIZE,
  GRADING_SCALES_OPTIONS_RESOURCE,
  GRADING_SCALES_QUERY_MODULE,
} from "@/services/modules/grading-scales/grading-scales-constant";

/** The grading scales an exam form picks from, as `{ id, name }` options. Reads one page of
 * `GRADING_SCALES_OPTIONS_PAGE_SIZE` as a cap: a school has a handful, so no cursor is followed. */
export function useGradingScaleOptions() {
  return useQuery({
    queryKey: queryKeys.list(GRADING_SCALES_QUERY_MODULE, GRADING_SCALES_OPTIONS_RESOURCE),
    queryFn: () =>
      Services.gradingScales.fetchScalesPage({ pageSize: GRADING_SCALES_OPTIONS_PAGE_SIZE }),
    select: (page) => page.items.map((scale) => ({ id: scale.id, name: scale.name })),
  });
}
