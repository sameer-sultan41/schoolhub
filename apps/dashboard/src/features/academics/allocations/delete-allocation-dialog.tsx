"use client";

import { useTranslations } from "next-intl";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { Services, type TeacherAllocationRecord } from "@/services";
import { useAllocationAction } from "./use-allocation-mutations";

export interface DeleteAllocationDialogProps {
  record: TeacherAllocationRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Removes an allocation entered by mistake (a reassignment ends the old one instead). */
export function DeleteAllocationDialog({
  record,
  open,
  onOpenChange,
}: DeleteAllocationDialogProps) {
  const t = useTranslations("academics");
  const { error, isPending, confirm } = useAllocationAction({
    run: () => Services.teacherAllocations.deleteAllocation(record.id).then(() => undefined),
    successMessage: t("allocations.removed"),
    onDone: () => {
      onOpenChange(false);
    },
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("allocations.delete.title")}
      description={t("allocations.delete.description")}
      confirmLabel={t("allocations.actions.delete")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
