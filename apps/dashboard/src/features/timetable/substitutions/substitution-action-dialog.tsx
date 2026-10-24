"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { formatDate } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import {
  ApiError,
  Services,
  type SubstitutionAction,
  type TeacherSubstitutionRecord,
} from "@/services";
import { SUBSTITUTIONS_QUERY_MODULE } from "@/services/modules/teacher-substitutions/teacher-substitutions-constant";

const TOAST_KEY: Record<SubstitutionAction, "approved" | "rejected" | "cancelled"> = {
  approve: "approved",
  reject: "rejected",
  cancel: "cancelled",
};

export interface SubstitutionActionDialogProps {
  record: TeacherSubstitutionRecord;
  action: SubstitutionAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Confirms one decision on a cover: approve, decline or cancel. A refusal shows inline and
 * the dialog stays open; a 409 (someone decided it first) also refreshes the queue, so the
 * row behind the dialog shows what actually happened.
 *
 * Mounting contract: the caller mounts this only while it is open.
 */
export function SubstitutionActionDialog({
  record,
  action,
  open,
  onOpenChange,
}: SubstitutionActionDialogProps) {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.module(SUBSTITUTIONS_QUERY_MODULE) });
  };

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: async () => {
      try {
        return await Services.teacherSubstitutions.decideSubstitution(record.id, action);
      } catch (decideError) {
        if (decideError instanceof ApiError && decideError.status === 409) refresh();
        throw decideError;
      }
    },
    onSuccess: () => {
      refresh();
      toast.success(t(`substitutions.${TOAST_KEY[action]}`));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(`substitutions.confirm.${action}.title`)}
      description={t(`substitutions.confirm.${action}.description`, {
        substitute: record.substitute_staff_name,
        section: record.section_name,
        period: record.period_name,
        date: formatDate(record.date, locale),
      })}
      confirmLabel={t(`substitutions.actions.${action}`)}
      variant={action === "approve" ? undefined : "destructive"}
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
