"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@schoolhub/ui";
import { Send } from "lucide-react";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { HTTP_STATUS_UNPROCESSABLE } from "@/lib/constants";
import { keepServerMessage } from "@/lib/keep-server-message";
import { ApiError, Services, type ExamRecord } from "@/services";
import { EXAM_SCHEDULES_QUERY_MODULE } from "@/services/modules/exam-schedules/exam-schedules-constant";
import { conflictsFromError } from "@/services/modules/exam-schedules/exam-schedules-helper";
import { guardRefusal } from "@/features/exams/guard-refusal";
import { scheduleConflictsKey } from "./use-schedule-conflicts";

const BLOCKED_NOTE_ID = "publish-schedule-blocked";

/**
 * Confirms and publishes the schedule, since it tells students and guardians. A refusal anyway
 * (a clash the page hadn't seen) keeps the dialog open with the server's sentence and replaces
 * the panel's list with the server's own (`error.meta.conflicts`), so the button then holds too.
 * Success invalidates the exam's reads: its status moves to `scheduled`.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with no
 * stale error.
 */
function PublishScheduleDialog({
  exam,
  onOpenChange,
}: {
  exam: ExamRecord;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const invalidateExams = useInvalidateModule(EXAM_SCHEDULES_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () =>
      guardRefusal(async () => {
        try {
          return await Services.examSchedules.publishSchedule(exam.id);
        } catch (publishError) {
          if (
            publishError instanceof ApiError &&
            publishError.status === HTTP_STATUS_UNPROCESSABLE
          ) {
            const refused = conflictsFromError(publishError);
            if (refused.length > 0) {
              queryClient.setQueryData(scheduleConflictsKey(exam.id), refused);
            }
            // Its sentence ("2 clashes must be resolved", "nothing to publish") is the reason.
            throw keepServerMessage(publishError);
          }
          throw publishError;
        }
      }, invalidateExams),
    onSuccess: () => {
      invalidateExams();
      toast.success(t("schedule.publish.done"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open
      onOpenChange={onOpenChange}
      title={t("schedule.publish.title")}
      description={t("schedule.publish.description")}
      confirmLabel={t("schedule.publish.confirm")}
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}

export interface PublishScheduleButtonProps {
  exam: ExamRecord;
  /** How many hard findings stand: any holds the button, and the count says why. */
  hardCount: number;
  /** The clash list hasn't loaded (or couldn't): publishing waits for it. */
  isChecking: boolean;
}

/** Publish schedule: held while a hard finding stands (the count beside it) or the clash list is
 * unknown. Soft findings never hold it. */
export function PublishScheduleButton({ exam, hardCount, isChecking }: PublishScheduleButtonProps) {
  const t = useTranslations("exams");
  const [open, setOpen] = useState(false);
  const isBlocked = hardCount > 0;

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {isBlocked && (
          <span id={BLOCKED_NOTE_ID} className="text-sm text-danger">
            {t("schedule.publish.blocked", { count: hardCount })}
          </span>
        )}
        <Button
          variant="primary"
          disabled={isBlocked || isChecking}
          aria-describedby={isBlocked ? BLOCKED_NOTE_ID : undefined}
          onClick={() => {
            setOpen(true);
          }}
        >
          <Send aria-hidden="true" />
          {t("schedule.publish.button")}
        </Button>
      </div>
      {open && <PublishScheduleDialog exam={exam} onOpenChange={setOpen} />}
    </>
  );
}
