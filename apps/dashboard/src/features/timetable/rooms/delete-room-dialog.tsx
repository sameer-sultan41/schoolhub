"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type RoomRecord } from "@/services";
import { ROOMS_QUERY_MODULE } from "@/services/modules/rooms/rooms-constant";

export interface DeleteRoomDialogProps {
  record: RoomRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Removes one room. The server refuses one a current grid cell or upcoming cover still
 * names (`rooms/services.assert_room_not_in_use`) and says why; that shows inline and the
 * dialog stays open. Taking it out of service is the alternative the description offers.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with
 * no stale error.
 */
export function DeleteRoomDialog({ record, open, onOpenChange }: DeleteRoomDialogProps) {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const invalidateRooms = useInvalidateModule(ROOMS_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => Services.rooms.deleteRoom(record.id),
    onSuccess: () => {
      invalidateRooms();
      toast.success(t("rooms.removed"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("rooms.delete.titleNamed", { name: record.name })}
      description={t("rooms.delete.description")}
      confirmLabel={t("rooms.actions.delete")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
