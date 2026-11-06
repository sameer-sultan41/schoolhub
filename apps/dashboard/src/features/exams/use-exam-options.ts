"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  EXAMS_OPTIONS_ORDERING,
  EXAMS_OPTIONS_PAGE_SIZE,
  EXAMS_OPTIONS_RESOURCE,
  EXAMS_QUERY_MODULE,
} from "@/services/modules/exams/exams-constant";

/** The exams a picker offers (the Reports section), newest first, each named with its session
 * so two years' "Midterm" tell apart. Reads one page of `EXAMS_OPTIONS_PAGE_SIZE` as a cap; an
 * exam write refreshes it through the exams module. `/exams` needs `exams.exam.view`: pass
 * `enabled: false` while the picker is hidden or the viewer lacks that key. */
export function useExamOptions({ enabled }: { enabled: boolean }) {
  const t = useTranslations("exams");
  return useQuery({
    queryKey: queryKeys.list(EXAMS_QUERY_MODULE, EXAMS_OPTIONS_RESOURCE),
    queryFn: () =>
      Services.exams.fetchExamsPage({
        pageSize: EXAMS_OPTIONS_PAGE_SIZE,
        ordering: EXAMS_OPTIONS_ORDERING,
      }),
    select: (page) =>
      page.items.map((exam) => ({
        id: exam.id,
        name: t("examOption", { name: exam.name, session: exam.academic_session_name }),
      })),
    enabled,
  });
}
