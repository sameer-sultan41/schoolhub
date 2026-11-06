"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { Services, type LeaveRequestRecord } from "@/services";
import { useInvalidatePortalLeave } from "./use-invalidate-portal-leave";

export interface CancelLeaveDialogProps {
  request: LeaveRequestRecord;
  onOpenChange: (open: boolean) => void;
}

/**
 * Withdraws a pending request. A refusal (it already started, or was decided meanwhile) shows
 * inline and the dialog stays open.
 *
 * Mounting contract: the list mounts this only while a request is picked, so every open starts
 * with no stale error.
 */
export function CancelLeaveDialog({ request, onOpenChange }: CancelLeaveDialogProps) {
  const t = useTranslations("portal.leave.cancel");
  const invalidate = useInvalidatePortalLeave();

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => Services.leaveRequests.cancelLeave(request.id),
    onSuccess: () => {
      invalidate();
      toast.success(t("done"));
      onOpenChange(false);
    },
    fallbackMessage: t("failed"),
  });

  return (
    <ResponsiveAlertDialog
      open
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("description", { type: request.leave_type_name })}
      confirmLabel={t("confirm")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
