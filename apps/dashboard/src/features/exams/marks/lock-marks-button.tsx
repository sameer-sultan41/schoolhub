"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@schoolhub/ui";
import { Lock, LockOpen } from "lucide-react";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import { Services, type MarksProgressRow } from "@/services";
import { MARKS_QUERY_MODULE } from "@/services/modules/marks/marks-constant";
import { guardRefusal } from "@/features/exams/guard-refusal";

/**
 * Confirms reopening a locked subject: every section of it takes marks again, and the server
 * audits the unlock. Mounted by the caller only while open, so it never shows a stale error.
 */
function UnlockMarksDialog({
  row,
  onOpenChange,
}: {
  row: MarksProgressRow;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateMarks = useInvalidateModule(MARKS_QUERY_MODULE);
  const subject = row.subject_name;

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () =>
      guardRefusal(() => Services.marks.unlockMarks(row.exam_subject_id), invalidateMarks),
    onSuccess: () => {
      invalidateMarks();
      toast.success(t("marks.lock.unlocked", { subject }));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open
      onOpenChange={onOpenChange}
      title={t("marks.lock.unlockTitle", { subject, class: row.class_name })}
      description={t("marks.lock.unlockDescription", { subject })}
      confirmLabel={t("marks.lock.unlockConfirm")}
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}

/**
 * Lock or Unlock one exam-subject's marks (`exams.marks.lock`; the caller checks the key). A
 * lock closes every section of the subject at once, so the button names the subject. Locking
 * runs straight away; unlocking confirms first, since it reopens settled marks and is audited.
 */
export function LockMarksButton({ row }: { row: MarksProgressRow }) {
  const t = useTranslations("exams");
  const tErrors = useTranslations("errors");
  const invalidateMarks = useInvalidateModule(MARKS_QUERY_MODULE);
  const [unlocking, setUnlocking] = useState(false);
  const subject = row.subject_name;
  const names = { subject, class: row.class_name };

  const lock = useMutation({
    mutationFn: () =>
      guardRefusal(() => Services.marks.lockMarks(row.exam_subject_id), invalidateMarks),
    onSuccess: () => {
      invalidateMarks();
      toast.success(t("marks.lock.locked", { subject }));
    },
    onError: (error: unknown) => {
      toast.error(resolveErrorMessage(error, tErrors, t("marks.lock.failed"), NON_FIELD));
    },
  });

  if (row.is_locked) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          aria-label={t("marks.lock.unlockRow", names)}
          onClick={() => {
            setUnlocking(true);
          }}
        >
          <LockOpen aria-hidden="true" />
          {t("marks.lock.unlock")}
        </Button>
        {unlocking && <UnlockMarksDialog row={row} onOpenChange={setUnlocking} />}
      </>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={t("marks.lock.lockRow", names)}
      disabled={lock.isPending}
      onClick={() => {
        lock.mutate();
      }}
    >
      <Lock aria-hidden="true" />
      {t("marks.lock.lock")}
    </Button>
  );
}
