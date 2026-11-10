"use client";

import { useTranslations } from "next-intl";

import { useUrlParams } from "@/hooks/use-url-params";
import { isUuid } from "@/lib/helpers";
import type { ExamRecord } from "@/services";
import {
  MARKS_SECTION_URL_KEY,
  MARKS_SUBJECT_URL_KEY,
} from "@/services/modules/marks/marks-constant";
import { MarksGridScreen } from "./marks-grid-screen";
import { MarksProgressTable, useMarksProgress } from "./marks-progress-table";

/**
 * The exam's Marks tab (`exams.marks.view`): the progress list, or, with `?subject=&section=` in
 * the URL, that section's grid. The grid's name comes from the progress list's row for it (one
 * cache entry); a link to a pair the list doesn't hold still opens, and the API answers 404 for
 * a section the viewer may not enter.
 */
export function MarksTab({ exam }: { exam: ExamRecord }) {
  const t = useTranslations("exams");
  const { searchParams, setParams } = useUrlParams();
  const subjectId = searchParams.get(MARKS_SUBJECT_URL_KEY) ?? "";
  const sectionId = searchParams.get(MARKS_SECTION_URL_KEY) ?? "";
  const progress = useMarksProgress(exam.id);

  if (isUuid(subjectId) && isUuid(sectionId)) {
    const row = progress.data?.find(
      (candidate) => candidate.exam_subject_id === subjectId && candidate.section_id === sectionId,
    );
    const heading = row
      ? t("marks.grid.heading", {
          subject: row.subject_name,
          class: row.class_name,
          section: row.section_name,
        })
      : t("marks.grid.headingFallback");
    return (
      <MarksGridScreen
        examId={exam.id}
        examSubjectId={subjectId}
        sectionId={sectionId}
        heading={heading}
        subjectName={row?.subject_name}
        onBack={() => {
          setParams({ [MARKS_SUBJECT_URL_KEY]: null, [MARKS_SECTION_URL_KEY]: null });
        }}
      />
    );
  }

  return (
    <MarksProgressTable
      exam={exam}
      onEnter={(row) => {
        setParams({
          [MARKS_SUBJECT_URL_KEY]: row.exam_subject_id,
          [MARKS_SECTION_URL_KEY]: row.section_id,
        });
      }}
    />
  );
}
