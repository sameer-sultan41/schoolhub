"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Textarea,
} from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { keepServerMessage } from "@/features/attendance/keep-server-message";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { EMPTY_VALUE } from "@/lib/constants";
import { formatDate } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import {
  ApiError,
  Services,
  type AttendanceCorrectionRecord,
  type CorrectionAction,
} from "@/services";
import {
  CORRECTION_DECISION_ERROR_FIELDS,
  CORRECTION_REVIEW_NOTE_MAX_LENGTH,
  CORRECTIONS_QUERY_MODULE,
} from "@/services/modules/attendance-corrections/attendance-corrections-constant";
import {
  createDecisionFormSchema,
  type CorrectionDecisionFormValues,
} from "@/services/modules/attendance-corrections/attendance-corrections.schema";
import { STUDENT_ATTENDANCE_QUERY_MODULE } from "@/services/modules/student-attendance/student-attendance-constant";

export interface CorrectionDecisionDialogProps {
  record: AttendanceCorrectionRecord;
  action: CorrectionAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Approves or rejects one pending correction, with an optional note to the requester. A refusal
 * shows inline and the dialog stays open. A 409 (someone decided it first) also reloads the
 * queue, so the row behind the dialog shows what happened, and holds the submit: the decision
 * can no longer be made.
 *
 * Mounting contract: the caller mounts this only while it is open.
 */
export function CorrectionDecisionDialog({
  record,
  action,
  open,
  onOpenChange,
}: CorrectionDecisionDialogProps) {
  const t = useTranslations("attendance");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [alreadyDecided, setAlreadyDecided] = useState(false);

  const schema = useMemo(
    () => createDecisionFormSchema({ noteTooLong: t("corrections.decision.noteTooLong") }),
    [t],
  );
  const form = useForm<CorrectionDecisionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { review_note: "" },
  });

  const refresh = (modules: readonly string[]) => {
    for (const queryModule of modules) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module(queryModule) });
    }
  };

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: async (values: CorrectionDecisionFormValues) => {
      try {
        return await Services.attendanceCorrections.decideCorrection(
          record.id,
          action,
          values.review_note,
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          setAlreadyDecided(true);
          refresh([CORRECTIONS_QUERY_MODULE]);
          throw keepServerMessage(error);
        }
        throw error;
      }
    },
    knownFields: CORRECTION_DECISION_ERROR_FIELDS,
    onSuccess: () => {
      // An approval rewrites the attendance record the correction names.
      refresh(
        action === "approve"
          ? [CORRECTIONS_QUERY_MODULE, STUDENT_ATTENDANCE_QUERY_MODULE]
          : [CORRECTIONS_QUERY_MODULE],
      );
      toast.success(t(`corrections.decision.${action}.done`));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t(`corrections.decision.${action}.title`)}
      description={t(`corrections.decision.${action}.description`, {
        name: record.student_name ?? EMPTY_VALUE,
        date: record.attendance_date ? formatDate(record.attendance_date, locale) : EMPTY_VALUE,
      })}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t(`corrections.decision.${action}.submitting`)}
      submitLabel={t(`corrections.decision.${action}.submit`)}
      submitDisabled={alreadyDecided}
    >
      <FormField
        control={form.control}
        name="review_note"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("corrections.decision.note")}</FormLabel>
            <FormControl>
              <Textarea maxLength={CORRECTION_REVIEW_NOTE_MAX_LENGTH} {...field} />
            </FormControl>
            <FormDescription>{t("corrections.decision.noteHint")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialogLayout>
  );
}
