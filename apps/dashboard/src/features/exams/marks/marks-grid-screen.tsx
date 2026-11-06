"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Alert, Button, EmptyState, Skeleton } from "@schoolhub/ui";
import { ArrowLeft, Lock, ShieldOff } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { ApiError, Services } from "@/services";
import { ImportMarksButton } from "./import-marks-button";
import { MarksGridTable } from "./marks-grid-table";
import { marksGridKey } from "./marks-query-keys";

export interface MarksGridScreenProps {
  examId: string;
  examSubjectId: string;
  sectionId: string;
  /** The subject, class and section, once the progress list names them. */
  heading: string;
  /** The exam-subject's name, for the import dialog, once the progress list names it. */
  subjectName: string | undefined;
  onBack: () => void;
}

/**
 * The grid for one (exam-subject, section), opened from the progress list or a shared link
 * (`?tab=marks&subject=&section=`). A section the viewer may not enter is a 404, which says so. A
 * grid the server won't take (`meta.writable` false) shows read-only, with the server's reason.
 */
export function MarksGridScreen({
  examId,
  examSubjectId,
  sectionId,
  heading,
  subjectName,
  onBack,
}: MarksGridScreenProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { data: user } = useCurrentUser();

  const query = useQuery({
    queryKey: marksGridKey({ examSubjectId, sectionId }),
    queryFn: () => Services.marks.fetchGrid({ examSubjectId, sectionId }),
  });
  const { data: grid, error } = query;
  const isNotFound = error instanceof ApiError && error.isNotFound;
  // Import needs its own key; a grid closed only for want of the entry key still takes a sheet.
  const canImport =
    hasPermission(user, "exams.marks.import") &&
    grid !== undefined &&
    (grid.meta.writable || grid.meta.unwritableReason === "no_permission");

  let body: ReactNode;
  if (grid) {
    body = (
      <MarksGridTable
        key={`${examSubjectId}|${sectionId}`}
        grid={grid}
        examId={examId}
        examSubjectId={examSubjectId}
        sectionId={sectionId}
        heading={heading}
      />
    );
  } else if (query.isPending) {
    body = (
      <div role="status" className="space-y-3">
        <span className="sr-only">{tCommon("loading")}</span>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  } else if (isNotFound) {
    body = (
      <EmptyState
        icon={ShieldOff}
        title={t("marks.grid.notFoundTitle")}
        description={t("marks.grid.notFoundDescription")}
      />
    );
  } else {
    body = (
      <LoadErrorCard
        message={resolveErrorMessage(error, tErrors, t("marks.grid.loadError"))}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  return (
    <section aria-label={heading} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
            {t("marks.grid.back")}
          </Button>
          <h2 className="text-base font-semibold">{heading}</h2>
        </div>
        {canImport && <ImportMarksButton examSubjectId={examSubjectId} subjectName={subjectName} />}
      </div>
      {grid && !grid.meta.writable && (
        <Alert variant="info" appearance="light">
          <span className="inline-flex items-center gap-2">
            <Lock aria-hidden="true" className="size-4 shrink-0" />
            {grid.meta.unwritableMessage ?? t("marks.grid.readOnly")}
          </span>
        </Alert>
      )}
      {body}
    </section>
  );
}
