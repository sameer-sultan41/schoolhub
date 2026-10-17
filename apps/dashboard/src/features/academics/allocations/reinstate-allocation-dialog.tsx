"use client";

import { useTranslations } from "next-intl";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { Services, type TeacherAllocationRecord } from "@/services";
import { useAllocationAction } from "./use-allocation-mutations";

export interface ReinstateAllocationDialogProps {
  record: TeacherAllocationRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Makes an ended allocation current again (a reinstated primary replaces the current one). */
export function ReinstateAllocationDialog({
  record,
  open,
  onOpenChange,
}: ReinstateAllocationDialogProps) {
  const t = useTranslations("academics");
  const { error, isPending, confirm } = useAllocationAction({
    run: () => Services.teacherAllocations.reinstateAllocation(record.id),
    successMessage: t("allocations.reinstated"),
    onDone: () => {
      onOpenChange(false);
    },
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("allocations.reinstate.title")}
      description={t("allocations.reinstate.description")}
      confirmLabel={t("allocations.actions.reinstate")}
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
