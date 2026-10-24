"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type TimetableConflict, type TimetableSlotRecord } from "@/services";
import {
  SLOT_ERROR_FIELDS,
  TIMETABLE_SLOTS_QUERY_MODULE,
} from "@/services/modules/timetable-slots/timetable-slots-constant";
import {
  buildSlotInput,
  slotToFormValues,
} from "@/services/modules/timetable-slots/timetable-slots-helper";
import {
  slotFormSchema,
  type SlotFormValues,
} from "@/services/modules/timetable-slots/timetable-slots.schema";
import { SlotFormFields } from "./slot-form-fields";

export interface SlotCellContext {
  academicSessionId: string;
  classId: string;
  sectionId: string;
  campusId: string;
  dayOfWeek: number;
  periodId: string;
  /** "Monday · Period 1", for the dialog's description. */
  label: string;
}

export interface SlotFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cell: SlotCellContext;
  /** The cell's current slot; omitted for an empty cell. */
  slot?: TimetableSlotRecord;
  /** The section's conflicts after the save, for the grid's panel and highlights. */
  onConflicts: (conflicts: TimetableConflict[]) => void;
}

/**
 * Fills or edits one cell. An empty cell, or a published one, gets a new draft (a published
 * cell is changed by drafting over it and republishing, never in place); a draft is updated.
 * The save always succeeds unless the server refuses a field: conflicts are reported, not
 * blocking, until publish.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is fresh.
 */
export function SlotFormDialog({
  open,
  onOpenChange,
  cell,
  slot,
  onConflicts,
}: SlotFormDialogProps) {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const invalidateSlots = useInvalidateModule(TIMETABLE_SLOTS_QUERY_MODULE);

  const form = useForm<SlotFormValues>({
    resolver: zodResolver(slotFormSchema),
    defaultValues: slotToFormValues(slot),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: SlotFormValues) => {
      const input = buildSlotInput(values, cell);
      return slot?.status === "draft"
        ? Services.timetableSlots.updateSlot(slot.id, input)
        : Services.timetableSlots.createSlot(input);
    },
    knownFields: SLOT_ERROR_FIELDS,
    onSuccess: (result) => {
      invalidateSlots();
      onConflicts(result.conflicts);
      toast.success(t("grid.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={slot ? t("slot.form.editTitle") : t("slot.form.createTitle")}
      description={cell.label}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <SlotFormFields
        form={form}
        academicSessionId={cell.academicSessionId}
        classId={cell.classId}
        sectionId={cell.sectionId}
        campusId={cell.campusId}
      />
    </FormDialogLayout>
  );
}
