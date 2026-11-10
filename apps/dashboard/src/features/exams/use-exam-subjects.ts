"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  EXAM_SUBJECTS_LIST_RESOURCE,
  EXAM_SUBJECTS_QUERY_MODULE,
} from "@/services/modules/exam-subjects/exam-subjects-constant";

/** One exam's whole subject list, under the key the Subjects tab reads it with: one cache entry,
 * so the sitting form's subject picker adds no request once that tab has loaded. */
export function useExamSubjects(examId: string) {
  return useQuery({
    queryKey: queryKeys.list(EXAM_SUBJECTS_QUERY_MODULE, EXAM_SUBJECTS_LIST_RESOURCE, { examId }),
    queryFn: () => Services.examSubjects.fetchExamSubjects(examId),
  });
}
