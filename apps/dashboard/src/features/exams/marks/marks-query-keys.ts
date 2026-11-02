import { queryKeys } from "@/lib/query-client";
import type { MarksGridQuery } from "@/services";
import { EXAMS_DETAIL_RESOURCE, EXAMS_QUERY_MODULE } from "@/services/modules/exams/exams-constant";
import {
  MARKS_GRID_RESOURCE,
  MARKS_PROGRESS_RESOURCE,
  MARKS_QUERY_MODULE,
} from "@/services/modules/marks/marks-constant";

// The Marks tab's query keys, shared by the reads and what a save refreshes.

export function marksGridKey({ examSubjectId, sectionId }: MarksGridQuery) {
  return queryKeys.list(MARKS_QUERY_MODULE, MARKS_GRID_RESOURCE, { examSubjectId, sectionId });
}

export function marksProgressKey(examId: string) {
  return queryKeys.list(MARKS_QUERY_MODULE, MARKS_PROGRESS_RESOURCE, { examId });
}

/** What a grid save changes: the grid, the exam's progress, and the exam (a first save moves it
 * to `marks_entry`). */
export function marksSaveKeys(examId: string, grid: MarksGridQuery) {
  return [
    marksGridKey(grid),
    marksProgressKey(examId),
    queryKeys.detail(EXAMS_QUERY_MODULE, EXAMS_DETAIL_RESOURCE, examId),
  ];
}
