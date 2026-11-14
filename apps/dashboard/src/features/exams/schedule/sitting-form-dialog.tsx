"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type ExamRecord, type SittingRecord } from "@/services";
import {
  EXAM_SCHEDULES_QUERY_MODULE,
  SITTING_ERROR_FIELDS,
} from "@/services/modules/exam-schedules/exam-schedules-constant";
import {
  buildSittingInput,
  defaultSittingFormValues,
  recordToSittingFormValues,
} from "@/services/modules/exam-schedules/exam-schedules-helper";
import {
  createSittingFormSchema,
  type SittingFormValues,
} from "@/services/modules/exam-schedules/exam-schedules.schema";
import { guardRefusal } from "@/features/exams/guard-refusal";
import { SittingFormFields } from "./sitting-form-fields";
import { useApplySittingWrite } from "./use-schedule-conflicts";

export interface SittingFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exam: ExamRecord;
  /** The sitting to reschedule; omitted to add one. */
  record?: SittingRecord;
}

/**
 * Adds a sitting to the exam, or reschedules one. A clash is not a refusal: the server saves the
 * sitting and answers with the exam's whole clash list, which goes straight into the panel's
 * cache; the exam's other reads reload. A real refusal shows under its field (a section of another
 * class under Section); a 409 (the sitting or the exam moved on while the dialog was open) reads in the
 * server's words, with the exam reloaded.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form.
 */
export function SittingFormDialog({ open, onOpenChange, exam, record }: SittingFormDialogProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateExams = useInvalidateModule(EXAM_SCHEDULES_QUERY_MODULE);
  const applySittingWrite = useApplySittingWrite(exam.id);

  const schema = useMemo(
    () =>
      createSittingFormSchema({
        required: tCommon("requiredField"),
        endBeforeStart: t("schedule.form.endBeforeStart"),
      }),
    [t, tCommon],
  );
  const form = useForm<SittingFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record ? recordToSittingFormValues(record) : defaultSittingFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: SittingFormValues) => {
      const input = buildSittingInput(values);
      return guardRefusal(
        () =>
          record
            ? Services.examSchedules.updateSitting(record.id, input)
            : Services.examSchedules.createSitting(input),
        invalidateExams,
      );
    },
    knownFields: SITTING_ERROR_FIELDS,
    onSuccess: (result) => {
      applySittingWrite(result.conflicts);
      toast.success(t("schedule.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={record ? t("schedule.form.editTitle") : t("schedule.form.createTitle")}
      description={t("schedule.form.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <SittingFormFields form={form} examId={exam.id} />
    </FormDialogLayout>
  );
}
