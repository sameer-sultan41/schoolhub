"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { foldUnknownFieldErrors, NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services, type CurriculumRecord } from "@/services";

export interface DeleteCurriculumDialogProps {
  record: CurriculumRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Removes one subject from a class's curriculum. The server may refuse (it would leave an
 * elective group with a single option, the mapping has live dependents, or the session is
 * locked), and says why in a 422; that shows inline and the dialog stays open.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts
 * with no stale error.
 */
export function DeleteCurriculumDialog({
  record,
  open,
  onOpenChange,
}: DeleteCurriculumDialogProps) {
  const t = useTranslations("academics");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => Services.curriculum.deleteCurriculum(record.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("curriculum") });
      toast.success(t("curriculum.removed"));
      onOpenChange(false);
    },
    onError: (mutationError) => {
      // The refusal can name any field (an elective group, say), and this dialog has none.
      setError(
        resolveErrorMessage(
          foldUnknownFieldErrors(mutationError),
          tErrors,
          t("common.submitFailed"),
          NON_FIELD,
        ),
      );
    },
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("curriculum.delete.title")}
      description={t("curriculum.delete.description", { subject: record.subject_name })}
      confirmLabel={t("curriculum.actions.delete")}
      variant="destructive"
      isPending={mutation.isPending}
      error={error ?? undefined}
      onConfirm={() => {
        setError(null);
        mutation.mutate();
      }}
    />
  );
}
