"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Skeleton } from "@schoolhub/ui";

import { LoadErrorCard } from "@/components/load-error-card";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetTitle,
} from "@/components/responsive-dialog";
import { useCurrentUser } from "@/hooks/use-current-user";
import { EMPTY_VALUE } from "@/lib/constants";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type ExamSubjectRecord, type MarksRecord, type ResultRecord } from "@/services";
import {
  RESULTS_QUERY_MODULE,
  STUDENT_MARKS_RESOURCE,
} from "@/services/modules/exam-results/exam-results-constant";
import { useExamSubjects } from "@/features/exams/use-exam-subjects";
import { ResultOutcomeBadge, ResultStatusBadge } from "./result-badges";

export interface ResultDetailSheetProps {
  examId: string;
  /** The result to show; `null` closes the sheet. */
  result: ResultRecord | null;
  onOpenChange: (open: boolean) => void;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

/** One subject's line: its marks out of the subject's maximum, or why there are none. */
function useMarkText() {
  const t = useTranslations("exams");
  return (mark: MarksRecord, subject: ExamSubjectRecord | undefined): string => {
    if (mark.is_absent) return t("marks.grid.absentValue");
    if (mark.is_exempt) return t("marks.grid.exemptValue");
    const theory = mark.theory_marks ?? EMPTY_VALUE;
    const obtained =
      mark.practical_marks === null
        ? theory
        : t("results.detail.theoryPractical", { theory, practical: mark.practical_marks });
    return subject ? t("results.detail.outOf", { obtained, max: subject.max_marks }) : obtained;
  };
}

/** The student's subject marks in this exam (`GET /marks?exam_id=&student_id=`), each named by
 * its exam-subject, read under the Subjects tab's key. */
function SubjectMarks({ examId, studentId }: { examId: string; studentId: string }) {
  const t = useTranslations("exams");
  const tErrors = useTranslations("errors");
  const markText = useMarkText();
  const subjectsQuery = useExamSubjects(examId);
  const marksQuery = useQuery({
    queryKey: queryKeys.list(RESULTS_QUERY_MODULE, STUDENT_MARKS_RESOURCE, { examId, studentId }),
    queryFn: () => Services.marks.fetchStudentMarks(examId, studentId),
  });

  if (marksQuery.isError) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(marksQuery.error, tErrors, t("results.detail.marksError"))}
        onRetry={() => {
          void marksQuery.refetch();
        }}
      />
    );
  }
  if (!marksQuery.data) {
    return (
      <div role="status" className="flex flex-col gap-2">
        <span className="sr-only">{t("results.detail.marksLoading")}</span>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }
  if (marksQuery.data.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("results.detail.noMarks")}</p>;
  }

  const subjects = new Map((subjectsQuery.data ?? []).map((subject) => [subject.id, subject]));
  return (
    <dl className="flex flex-col divide-y divide-border">
      {marksQuery.data.map((mark) => {
        const subject = subjects.get(mark.exam_subject_id);
        return (
          <div key={mark.id} className="flex items-center justify-between gap-3 py-2">
            <dt className="text-sm text-foreground">{subject?.subject_name ?? EMPTY_VALUE}</dt>
            <dd className="text-sm font-medium text-foreground">{markText(mark, subject)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * One student's result in full: the server's figures, who processed and approved it, and their
 * subject marks for a holder of `exams.marks.view` (a note instead for anyone else, and no read).
 * Read-only: Withhold is the list's row action.
 */
export function ResultDetailSheet({ examId, result, onOpenChange }: ResultDetailSheetProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const { data: user } = useCurrentUser();
  // `GET /marks` takes `exams.marks.view`, which not every Results viewer holds.
  const canReadMarks = hasPermission(user, "exams.marks.view");

  return (
    <ResponsiveSheet open={result !== null} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent
        closeLabel={tCommon("close")}
        className="gap-0 p-0 sm:w-[440px] sm:max-w-none"
      >
        <div className="flex flex-col gap-1.5 border-b border-border px-6 py-5 pe-14">
          <ResponsiveSheetTitle className="text-lg font-semibold">
            {result ? t("results.detail.title", { name: result.student_name }) : ""}
          </ResponsiveSheetTitle>
          {result && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {t("results.detail.admissionNumber", { number: result.admission_number })}
              </span>
              <ResultStatusBadge status={result.status} />
              <ResultOutcomeBadge outcome={result.outcome} />
            </div>
          )}
        </div>
        {result && (
          <ResponsiveSheetBody className="flex flex-col gap-6 px-6 py-5">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-4">
              <Fact label={t("results.columns.section")}>{result.section_name}</Fact>
              <Fact label={t("results.detail.rank")}>
                {result.rank_in_section?.toLocaleString() ?? EMPTY_VALUE}
              </Fact>
              <Fact label={t("results.detail.total")}>
                {t("results.detail.outOf", {
                  obtained: result.total_obtained_marks,
                  max: result.total_max_marks,
                })}
              </Fact>
              <Fact label={t("results.columns.percentage")}>
                {t("results.percent", { value: result.percentage })}
              </Fact>
              <Fact label={t("results.columns.grade")}>{result.grade}</Fact>
              <Fact label={t("results.columns.gpa")}>{result.gpa ?? EMPTY_VALUE}</Fact>
              <Fact label={t("results.detail.processedBy")}>
                {result.processed_by_name ?? EMPTY_VALUE}
              </Fact>
              <Fact label={t("results.detail.approvedBy")}>
                {result.approved_by_name ?? EMPTY_VALUE}
              </Fact>
            </dl>
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {t("results.detail.subjects")}
              </h3>
              {canReadMarks ? (
                <SubjectMarks examId={examId} studentId={result.student_id} />
              ) : (
                <p className="text-sm text-muted-foreground">{t("results.detail.marksHidden")}</p>
              )}
            </section>
          </ResponsiveSheetBody>
        )}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
