"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { useAcademicSession } from "@/components/academic-session/use-academic-session";
import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type ExamRecord } from "@/services";
import { EXAM_ERROR_FIELDS, EXAMS_QUERY_MODULE } from "@/services/modules/exams/exams-constant";
import {
  buildExamInput,
  defaultExamFormValues,
  recordToExamFormValues,
} from "@/services/modules/exams/exams-helper";
import { createExamFormSchema, type ExamFormValues } from "@/services/modules/exams/exams.schema";
import { guardRefusal } from "@/features/exams/guard-refusal";
import { ExamFormFields } from "./exam-form-fields";

export interface ExamFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The exam to edit; omitted to add one. */
  record?: ExamRecord;
}

/**
 * Adds an exam, or edits one. A server error that names a field shows under it; any other is the
 * form's own message (a 409 for an exam past `scheduled` reads in the server's words there). A new
 * exam starts in the current session when there is one.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form;
 * an edit starts from the record the caller holds.
 */
export function ExamFormDialog({ open, onOpenChange, record }: ExamFormDialogProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateExams = useInvalidateModule(EXAMS_QUERY_MODULE);
  const { session: currentSession } = useAcademicSession("");

  const schema = useMemo(
    () =>
      createExamFormSchema({
        required: tCommon("requiredField"),
        weightageInvalid: t("form.weightageInvalid"),
        endsBeforeStart: t("form.endsBeforeStart"),
        bothDates: t("form.bothDates"),
      }),
    [t, tCommon],
  );
  const form = useForm<ExamFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record
      ? recordToExamFormValues(record)
      : defaultExamFormValues(currentSession?.id ?? ""),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: ExamFormValues) =>
      guardRefusal(
        () =>
          record
            ? Services.exams.updateExam(record.id, buildExamInput(values))
            : Services.exams.createExam(buildExamInput(values)),
        invalidateExams,
      ),
    knownFields: EXAM_ERROR_FIELDS,
    onSuccess: () => {
      invalidateExams();
      toast.success(t("saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={record ? t("form.editTitle") : t("form.createTitle")}
      description={t("form.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <ExamFormFields form={form} />
    </FormDialogLayout>
  );
}
