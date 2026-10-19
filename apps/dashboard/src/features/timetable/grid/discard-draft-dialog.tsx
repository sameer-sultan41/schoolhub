"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { queryKeys } from "@/lib/query-client";
import { Services, type TimetableConflict, type TimetableSlotRecord } from "@/services";
import { TIMETABLE_SLOTS_QUERY_MODULE } from "@/services/modules/timetable-slots/timetable-slots-constant";

export interface DiscardDraftDialogProps {
  slot: TimetableSlotRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConflicts: (conflicts: TimetableConflict[]) => void;
}

/**
 * Discards a draft cell. A published cell under it stays: there is no way to clear a published
 * cell (deferred-work.md), so this is only ever offered on a draft.
 *
 * Mounting contract: the caller mounts this only while it is open.
 */
export function DiscardDraftDialog({
  slot,
  open,
  onOpenChange,
  onConflicts,
}: DiscardDraftDialogProps) {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => Services.timetableSlots.deleteSlot(slot.id),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.module(TIMETABLE_SLOTS_QUERY_MODULE),
      });
      onConflicts(result.conflicts);
      toast.success(t("grid.discarded"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("slot.discard.title")}
      description={t("slot.discard.description")}
      confirmLabel={t("slot.actions.discard")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
