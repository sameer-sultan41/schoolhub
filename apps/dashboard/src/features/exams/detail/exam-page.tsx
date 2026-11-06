"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Skeleton } from "@schoolhub/ui";
import { ClipboardList } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { Paths } from "@/config/paths";
import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services } from "@/services";
import { EXAMS_DETAIL_RESOURCE, EXAMS_QUERY_MODULE } from "@/services/modules/exams/exams-constant";
import { ExamHeader } from "./exam-header";
import { ExamTabs } from "./exam-tabs";

/**
 * One exam: its header and stepper, then its tabs. An exam the API can't find (or that another
 * school owns: the API answers 404 for both) says so, with a way back.
 */
export function ExamPage({ examId }: { examId: string }) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");

  const query = useQuery({
    queryKey: queryKeys.detail(EXAMS_QUERY_MODULE, EXAMS_DETAIL_RESOURCE, examId),
    queryFn: () => Services.exams.fetchExam(examId),
  });
  const { data: exam, error, isPending } = query;

  if (exam) {
    return (
      <>
        <ExamHeader exam={exam} />
        <ExamTabs exam={exam} />
      </>
    );
  }

  if (isPending) {
    return (
      <div role="status" className="space-y-4">
        <span className="sr-only">{tCommon("loading")}</span>
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error instanceof ApiError && error.isNotFound) {
    return (
      <EmptyState
        icon={ClipboardList}
        title={t("detail.notFoundTitle")}
        description={t("detail.notFoundDescription")}
        action={
          <Button variant="outline" asChild>
            <Link href={Paths.EXAMS}>{t("actions.backToList")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <LoadErrorCard
      message={resolveErrorMessage(error, tErrors, t("detail.loadError"))}
      onRetry={() => {
        void query.refetch();
      }}
    />
  );
}
