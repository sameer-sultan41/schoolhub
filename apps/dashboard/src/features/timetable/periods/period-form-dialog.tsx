"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type PeriodRecord } from "@/services";
import {
  PERIODS_ERROR_FIELDS,
  PERIODS_QUERY_MODULE,
} from "@/services/modules/periods/periods-constant";
import {
  buildPeriodInput,
  defaultPeriodFormValues,
  recordToPeriodFormValues,
} from "@/services/modules/periods/periods-helper";
import {
  createPeriodFormSchema,
  type PeriodFormValues,
} from "@/services/modules/periods/periods.schema";
import { PeriodFormFields } from "./period-form-fields";

export interface PeriodFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The period to edit; omitted to add one. */
  record?: PeriodRecord;
}

/**
 * Adds a period to the bell schedule, or edits one. An overlap with another period at the
 * same campus (or a tenant-wide one) comes back as a 422 on `start_time`, shown there.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * form. An edit starts from the row the table holds, so no prefill lands after mount.
 */
export function PeriodFormDialog({ open, onOpenChange, record }: PeriodFormDialogProps) {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const invalidatePeriods = useInvalidateModule(PERIODS_QUERY_MODULE);

  const schema = useMemo(
    () =>
      createPeriodFormSchema({
        required: tCommon("requiredField"),
        sequenceInvalid: t("periods.form.sequenceInvalid"),
        endBeforeStart: t("periods.form.endBeforeStart"),
      }),
    [t, tCommon],
  );
  const form = useForm<PeriodFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record ? recordToPeriodFormValues(record) : defaultPeriodFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: PeriodFormValues) =>
      record
        ? Services.periods.updatePeriod(record.id, buildPeriodInput(values))
        : Services.periods.createPeriod(buildPeriodInput(values)),
    knownFields: PERIODS_ERROR_FIELDS,
    onSuccess: () => {
      invalidatePeriods();
      toast.success(t("periods.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={record ? t("periods.form.editTitle") : t("periods.form.createTitle")}
      description={t("periods.form.description")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <PeriodFormFields form={form} />
    </FormDialogLayout>
  );
}
