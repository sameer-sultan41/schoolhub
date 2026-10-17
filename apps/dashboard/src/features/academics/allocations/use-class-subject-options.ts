"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  CURRICULUM_FOR_CLASS_RESOURCE,
  CURRICULUM_QUERY_MODULE,
} from "@/services/modules/curriculum/curriculum-constant";
import { curriculumToSubjectOptions } from "@/services/modules/teacher-allocations/teacher-allocations-helper";

/** A class's curriculum subjects for a session: the only ones to allocate. Needs a class. */
export function useClassSubjectOptions(sessionId: string, classId: string) {
  return useQuery({
    queryKey: queryKeys.list(CURRICULUM_QUERY_MODULE, CURRICULUM_FOR_CLASS_RESOURCE, {
      academicSessionId: sessionId,
      classId,
    }),
    queryFn: () => Services.curriculum.fetchCurriculumForClass(sessionId, classId),
    select: curriculumToSubjectOptions,
    enabled: classId !== "",
  });
}
