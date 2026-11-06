"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type GradingScaleRecord } from "@/services";
import {
  GRADING_SCALES_QUERY_MODULE,
  SCALE_ERROR_FIELDS,
} from "@/services/modules/grading-scales/grading-scales-constant";
import {
  buildScaleInput,
  defaultScaleFormValues,
  recordToScaleFormValues,
} from "@/services/modules/grading-scales/grading-scales-helper";
import {
  createScaleFormSchema,
  type ScaleFormValues,
} from "@/services/modules/grading-scales/grading-scales.schema";
import { GradingScaleFormFields } from "./grading-scale-form-fields";

export interface GradingScaleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The scale to edit; omitted to add one. */
  record?: GradingScaleRecord;
}

/**
 * Adds a grading scale, or edits one. A server error that names a field is shown under it; any
 * other is the form's own message. Whether a scale is the default is not a field here: it moves
 * through Make default.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * form. An edit starts from the row the table holds, so no prefill lands after mount.
 */
export function GradingScaleFormDialog({
  open,
  onOpenChange,
  record,
}: GradingScaleFormDialogProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateScales = useInvalidateModule(GRADING_SCALES_QUERY_MODULE);

  const schema = useMemo(
    () =>
      createScaleFormSchema({
        required: tCommon("requiredField"),
        decimalInvalid: t("gradingScales.form.decimalInvalid"),
      }),
    [t, tCommon],
  );
  const form = useForm<ScaleFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record ? recordToScaleFormValues(record) : defaultScaleFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: ScaleFormValues) =>
      record
        ? Services.gradingScales.updateScale(record.id, buildScaleInput(values))
        : Services.gradingScales.createScale(buildScaleInput(values)),
    knownFields: SCALE_ERROR_FIELDS,
    onSuccess: () => {
      invalidateScales();
      toast.success(t("gradingScales.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={record ? t("gradingScales.form.editTitle") : t("gradingScales.form.createTitle")}
      description={t("gradingScales.form.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <GradingScaleFormFields form={form} />
    </FormDialogLayout>
  );
}
