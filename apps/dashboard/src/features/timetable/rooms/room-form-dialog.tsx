"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type RoomRecord } from "@/services";
import { ROOMS_ERROR_FIELDS, ROOMS_QUERY_MODULE } from "@/services/modules/rooms/rooms-constant";
import {
  buildRoomInput,
  defaultRoomFormValues,
  recordToRoomFormValues,
} from "@/services/modules/rooms/rooms-helper";
import { createRoomFormSchema, type RoomFormValues } from "@/services/modules/rooms/rooms.schema";
import { RoomFormFields } from "./room-form-fields";

export interface RoomFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The room to edit; omitted to add one. */
  record?: RoomRecord;
}

/**
 * Adds a room, or edits one. A server error that names a field is shown under it; any other
 * is the form's own message.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * form. An edit starts from the row the table holds, so no prefill lands after mount.
 */
export function RoomFormDialog({ open, onOpenChange, record }: RoomFormDialogProps) {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const invalidateRooms = useInvalidateModule(ROOMS_QUERY_MODULE);

  const schema = useMemo(
    () =>
      createRoomFormSchema({
        required: tCommon("requiredField"),
        capacityInvalid: t("rooms.form.capacityInvalid"),
      }),
    [t, tCommon],
  );
  const form = useForm<RoomFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record ? recordToRoomFormValues(record) : defaultRoomFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: RoomFormValues) =>
      record
        ? Services.rooms.updateRoom(record.id, buildRoomInput(values))
        : Services.rooms.createRoom(buildRoomInput(values)),
    knownFields: ROOMS_ERROR_FIELDS,
    onSuccess: () => {
      invalidateRooms();
      toast.success(t("rooms.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={record ? t("rooms.form.editTitle") : t("rooms.form.createTitle")}
      description={t("rooms.form.description")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <RoomFormFields form={form} />
    </FormDialogLayout>
  );
}
