"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { queryKeys } from "@/lib/query-client";
import { Services, type TimetableConflict } from "@/services";
import { TIMETABLE_SLOTS_QUERY_MODULE } from "@/services/modules/timetable-slots/timetable-slots-constant";
import { conflictsFromError } from "@/services/modules/timetable-slots/timetable-slots-helper";

export interface PublishDialogProps {
  sectionId: string;
  academicSessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The findings to show: a success's soft ones, or a refusal's hard ones. */
  onConflicts: (conflicts: TimetableConflict[]) => void;
}

/**
 * Confirms and publishes a section's drafts. A refusal for hard conflicts keeps the dialog open
 * with the server's reason and puts the findings (from `error.meta.conflicts`) in the grid's
 * panel. Success refreshes the grid and the home screen's "my timetable".
 *
 * Mounting contract: the caller mounts this only while it is open.
 */
export function PublishDialog({
  sectionId,
  academicSessionId,
  open,
  onOpenChange,
  onConflicts,
}: PublishDialogProps) {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: async () => {
      try {
        return await Services.timetableSlots.publishSection(sectionId, academicSessionId);
      } catch (publishError) {
        const refused = conflictsFromError(publishError);
        if (refused.length > 0) onConflicts(refused);
        throw publishError;
      }
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.module(TIMETABLE_SLOTS_QUERY_MODULE),
      });
      // The home screen's "next period" reads the published week.
      void queryClient.invalidateQueries({ queryKey: queryKeys.myTimetable() });
      onConflicts(result.conflicts);
      toast.success(t("grid.published", { count: result.published }));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("publish.title")}
      description={t("publish.description")}
      confirmLabel={t("actions.publish")}
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
