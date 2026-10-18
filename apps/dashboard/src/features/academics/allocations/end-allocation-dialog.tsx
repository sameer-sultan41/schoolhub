"use client";

import { useTranslations } from "next-intl";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { todayIsoDate } from "@/lib/helpers";
import { Services, type TeacherAllocationRecord } from "@/services";
import { useAllocationAction } from "./use-allocation-mutations";

export interface EndAllocationDialogProps {
  record: TeacherAllocationRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Ends an allocation today (the UTC date, as the server counts it). Mounted only while open. */
export function EndAllocationDialog({ record, open, onOpenChange }: EndAllocationDialogProps) {
  const t = useTranslations("academics");
  const { error, isPending, confirm } = useAllocationAction({
    run: () => Services.teacherAllocations.endAllocation(record.id, todayIsoDate()),
    successMessage: t("allocations.ended"),
    onDone: () => {
      onOpenChange(false);
    },
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("allocations.end.title")}
      description={t("allocations.end.description")}
      confirmLabel={t("allocations.actions.end")}
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
