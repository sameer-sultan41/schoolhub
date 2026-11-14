"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type FeeScheduleRecord, type FeeStructureRecord } from "@/services";
import { FEE_STRUCTURES_QUERY_MODULE } from "@/services/modules/fee-structures/fee-structures-constant";
import {
  buildFeeScheduleInput,
  defaultFeeScheduleFormValues,
  feeScheduleErrorFields,
  recordToFeeScheduleFormValues,
} from "@/services/modules/fee-schedules/fee-schedules-helper";
import {
  createFeeScheduleFormSchema,
  type FeeScheduleFormValues,
} from "@/services/modules/fee-schedules/fee-schedules.schema";
import { ScheduleFormFields } from "./schedule-form-fields";

export interface ScheduleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  structure: FeeStructureRecord;
  /** The schedule to edit; omitted to add one. */
  record?: FeeScheduleRecord;
}

/**
 * Adds a fee schedule to a draft structure, or edits one. A server error that names a field is
 * shown under it: a due rule the frequency needs (`term`, `due_day`, `due_date`) under that
 * input, a bad head or amount under its own. Any other (a structure that is no longer a draft)
 * is the form's own message. The structure's schedules are part of the structure, so a save
 * refreshes the fee-structures module.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * form. An edit starts from the record the caller holds, so no prefill lands after mount.
 */
export function ScheduleFormDialog({
  open,
  onOpenChange,
  structure,
  record,
}: ScheduleFormDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidateStructures = useInvalidateModule(FEE_STRUCTURES_QUERY_MODULE);

  const schema = useMemo(
    () =>
      createFeeScheduleFormSchema({
        required: tCommon("requiredField"),
        amountInvalid: t("structures.schedules.form.amountInvalid"),
        dueDayInvalid: t("structures.schedules.form.dueDayInvalid"),
      }),
    [t, tCommon],
  );
  const form = useForm<FeeScheduleFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record ? recordToFeeScheduleFormValues(record) : defaultFeeScheduleFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: FeeScheduleFormValues) => {
      const input = buildFeeScheduleInput(values, structure.id);
      return record
        ? Services.feeSchedules.updateFeeSchedule(record.id, input)
        : Services.feeSchedules.createFeeSchedule(input);
    },
    // Read at error time: the due-rule inputs shown depend on the frequency picked.
    knownFields: () => feeScheduleErrorFields(form.getValues("frequency")),
    onSuccess: () => {
      invalidateStructures();
      toast.success(t("structures.schedules.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={
        record
          ? t("structures.schedules.form.editTitle")
          : t("structures.schedules.form.createTitle")
      }
      description={t("structures.schedules.form.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <ScheduleFormFields form={form} structure={structure} record={record} />
    </FormDialogLayout>
  );
}
