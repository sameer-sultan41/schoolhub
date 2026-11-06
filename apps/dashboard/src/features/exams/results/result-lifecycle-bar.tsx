"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { CircleCheck, RotateCw, Send, Undo2 } from "lucide-react";

import { useCurrentUser } from "@/hooks/use-current-user";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type ExamRecord } from "@/services";
import {
  APPROVABLE_EXAM_STATUS,
  PROCESSABLE_EXAM_STATUSES,
  PUBLISHABLE_EXAM_STATUS,
  RESULT_STATUS_PENDING,
  RESULTS_PENDING_RESOURCE,
  RESULTS_QUERY_MODULE,
  SEND_BACK_EXAM_STATUSES,
} from "@/services/modules/exam-results/exam-results-constant";
import { isProcessor } from "@/services/modules/exam-results/exam-results-helper";
import { ProcessResultsButton } from "./process-results-button";
import {
  ApproveResultsDialog,
  PublishResultsDialog,
  SendBackResultsDialog,
} from "./result-lifecycle-dialogs";

const APPROVE_NOTE_ID = "approve-results-note";

type LifecycleDialog = "approve" | "sendBack" | "publish";

/**
 * The Results tab's lifecycle actions, each on its key and the exam's status: Process (while
 * results may still be recomputed), Approve and Send back (once processed), Publish (once
 * approved). Approve is held for the user who ran the latest processing, with the reason beside
 * it: every run re-stamps `processed_by` on the pending rows, so one pending row names the
 * processor for them all. The server enforces the rule too (a 422).
 */
export function ResultLifecycleBar({ exam }: { exam: ExamRecord }) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { data: user } = useCurrentUser();
  const [dialog, setDialog] = useState<LifecycleDialog | null>(null);

  const canProcess =
    hasPermission(user, "exams.result.create") && PROCESSABLE_EXAM_STATUSES.includes(exam.status);
  const canApprove = hasPermission(user, "exams.result.approve");
  const canPublish = hasPermission(user, "exams.result.publish");
  const showApprove = canApprove && exam.status === APPROVABLE_EXAM_STATUS;
  const showSendBack = canApprove && SEND_BACK_EXAM_STATUSES.includes(exam.status);
  const showPublish = canPublish && exam.status === PUBLISHABLE_EXAM_STATUS;

  const pendingQuery = useQuery({
    queryKey: queryKeys.list(RESULTS_QUERY_MODULE, RESULTS_PENDING_RESOURCE, { examId: exam.id }),
    queryFn: () =>
      Services.examResults.fetchResultsPage({
        examId: exam.id,
        status: RESULT_STATUS_PENDING,
        pageSize: 1,
      }),
    enabled: showApprove,
  });
  const pending = pendingQuery.data?.items[0];
  const processorName = pending?.processed_by_name ?? null;
  const isOwnRun = isProcessor(user?.id, pending);
  const hasNothingPending = pendingQuery.isSuccess && pending === undefined;
  // Held until the pending rows are known, and for their processor.
  const isApproveHeld = !pendingQuery.isSuccess || hasNothingPending || isOwnRun;

  let approveNote: string | null = null;
  if (pendingQuery.isError) {
    // Never a silent hold: say the read failed, with a retry beside it.
    approveNote = resolveErrorMessage(pendingQuery.error, tErrors, t("results.approve.loadError"));
  } else if (isOwnRun) {
    approveNote = t("results.approve.ownRun");
  } else if (hasNothingPending) {
    approveNote = t("results.approve.nothingPending");
  }

  if (!canProcess && !showApprove && !showSendBack && !showPublish) return null;

  const closeDialog = (open: boolean) => {
    if (!open) setDialog(null);
  };

  return (
    <div className="flex flex-col items-end gap-3">
      {canProcess && <ProcessResultsButton exam={exam} />}
      {(showApprove || showSendBack || showPublish) && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {processorName !== null && (
            <span className="text-sm text-muted-foreground">
              {t("results.processedBy", { name: processorName })}
            </span>
          )}
          {approveNote !== null && (
            <span id={APPROVE_NOTE_ID} className="text-sm text-muted-foreground">
              {approveNote}
            </span>
          )}
          {pendingQuery.isError && (
            <Button
              variant="outline"
              onClick={() => {
                void pendingQuery.refetch();
              }}
            >
              <RotateCw aria-hidden="true" />
              {tCommon("retry")}
            </Button>
          )}
          {showSendBack && (
            <Button
              variant="outline"
              onClick={() => {
                setDialog("sendBack");
              }}
            >
              <Undo2 aria-hidden="true" />
              {t("results.sendBack.button")}
            </Button>
          )}
          {showApprove && (
            <Button
              variant="primary"
              disabled={isApproveHeld}
              aria-describedby={approveNote === null ? undefined : APPROVE_NOTE_ID}
              onClick={() => {
                setDialog("approve");
              }}
            >
              <CircleCheck aria-hidden="true" />
              {t("results.approve.button")}
            </Button>
          )}
          {showPublish && (
            <Button
              variant="primary"
              onClick={() => {
                setDialog("publish");
              }}
            >
              <Send aria-hidden="true" />
              {t("results.publish.button")}
            </Button>
          )}
        </div>
      )}
      {dialog === "approve" && <ApproveResultsDialog exam={exam} onOpenChange={closeDialog} />}
      {dialog === "sendBack" && <SendBackResultsDialog exam={exam} onOpenChange={closeDialog} />}
      {dialog === "publish" && <PublishResultsDialog exam={exam} onOpenChange={closeDialog} />}
    </div>
  );
}
