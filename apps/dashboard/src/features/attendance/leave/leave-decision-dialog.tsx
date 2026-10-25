"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
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
import { useLeaveDates } from "@/features/attendance/leave/use-leave-dates";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services, type LeaveAction, type LeaveRequestRecord } from "@/services";
import {
  LEAVE_DECISION_ERROR_FIELDS,
  LEAVE_NOTE_MAX_LENGTH,
  LEAVE_QUERY_MODULE,
} from "@/services/modules/leave-requests/leave-requests-constant";
import { leaveDecisionOutcome } from "@/services/modules/leave-requests/leave-requests-helper";
import {
  createLeaveDecisionSchema,
  type LeaveDecisionFormValues,
} from "@/services/modules/leave-requests/leave-requests.schema";
import { STUDENT_ATTENDANCE_QUERY_MODULE } from "@/services/modules/student-attendance/student-attendance-constant";

export interface LeaveDecisionDialogProps {
  request: LeaveRequestRecord;
  action: LeaveAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Approves or rejects the current step of one pending leave request, with an optional note. A
 * refusal (the approver is the submitter, decided an earlier level, or lacks the scope level 2
 * needs) shows inline in the server's own words and the dialog stays open. A 409 (someone
 * decided first) also reloads the queue and holds the submit: the decision can no longer be
 * made. The toast says what the decision did: how many days were marked, or that the request
 * now waits for the next level.
 *
 * Mounting contract: the caller mounts this only while it is open.
 */
export function LeaveDecisionDialog({
  request,
  action,
  open,
  onOpenChange,
}: LeaveDecisionDialogProps) {
  const t = useTranslations("attendance");
  const tCommon = useTranslations("common");
  const leaveDates = useLeaveDates();
  const queryClient = useQueryClient();
  const [alreadyDecided, setAlreadyDecided] = useState(false);

  const schema = useMemo(
    () => createLeaveDecisionSchema({ noteTooLong: t("leave.decision.noteTooLong") }),
    [t],
  );
  const form = useForm<LeaveDecisionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { note: "" },
  });

  const refresh = (modules: readonly string[]) => {
    for (const queryModule of modules) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module(queryModule) });
    }
  };

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: async (values: LeaveDecisionFormValues) => {
      try {
        return await Services.leaveRequests.decideLeave(request.id, action, values.note);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          setAlreadyDecided(true);
          refresh([LEAVE_QUERY_MODULE]);
          throw keepServerMessage(error);
        }
        throw error;
      }
    },
    knownFields: LEAVE_DECISION_ERROR_FIELDS,
    onSuccess: (result) => {
      // An approval auto-marks the request's days in the attendance records.
      refresh(
        action === "approve"
          ? [LEAVE_QUERY_MODULE, STUDENT_ATTENDANCE_QUERY_MODULE]
          : [LEAVE_QUERY_MODULE],
      );
      const { key, values } = leaveDecisionOutcome(action, result);
      toast.success(t(`leave.decision.${key}`, values));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t(`leave.decision.${action}.title`)}
      description={t(`leave.decision.${action}.description`, {
        name: request.student_name,
        dates: leaveDates(request),
        level: request.current_approval_level,
        total: request.approvals.length,
      })}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t(`leave.decision.${action}.submitting`)}
      submitLabel={t(`leave.decision.${action}.submit`)}
      submitDisabled={alreadyDecided}
    >
      <FormField
        control={form.control}
        name="note"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("leave.decision.note")}</FormLabel>
            <FormControl>
              <Textarea maxLength={LEAVE_NOTE_MAX_LENGTH} {...field} />
            </FormControl>
            <FormDescription>{t("leave.decision.noteHint")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialogLayout>
  );
}
