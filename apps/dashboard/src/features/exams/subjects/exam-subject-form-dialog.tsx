"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type ExamRecord, type ExamSubjectRecord } from "@/services";
import {
  EXAM_SUBJECT_ERROR_FIELDS,
  EXAM_SUBJECTS_QUERY_MODULE,
} from "@/services/modules/exam-subjects/exam-subjects-constant";
import {
  buildExamSubjectInput,
  defaultExamSubjectFormValues,
  recordToExamSubjectFormValues,
} from "@/services/modules/exam-subjects/exam-subjects-helper";
import {
  createExamSubjectFormSchema,
  type ExamSubjectFormValues,
} from "@/services/modules/exam-subjects/exam-subjects.schema";
import { guardRefusal } from "@/features/exams/guard-refusal";
import { ExamSubjectFormFields } from "./exam-subject-form-fields";

export interface ExamSubjectFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exam: ExamRecord;
  /** The row to edit; omitted to add one. */
  record?: ExamSubjectRecord;
}

/**
 * Adds a subject to the exam, or edits one. A server error that names a field shows under it
 * (the duplicate class and subject under Subject); a refusal of the exam's own state (it moved
 * past `scheduled` while the dialog was open) reads in the server's words, and the exam is
 * reloaded so the page reflects it.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form.
 */
export function ExamSubjectFormDialog({
  open,
  onOpenChange,
  exam,
  record,
}: ExamSubjectFormDialogProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateExams = useInvalidateModule(EXAM_SUBJECTS_QUERY_MODULE);

  const schema = useMemo(
    () =>
      createExamSubjectFormSchema({
        required: tCommon("requiredField"),
        marksInvalid: t("subjects.form.marksInvalid"),
        weightageInvalid: t("subjects.form.weightageInvalid"),
        passAboveMax: t("subjects.form.passAboveMax"),
        windowOrder: t("subjects.form.windowOrder"),
      }),
    [t, tCommon],
  );
  const form = useForm<ExamSubjectFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record ? recordToExamSubjectFormValues(record) : defaultExamSubjectFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: ExamSubjectFormValues) => {
      const input = buildExamSubjectInput(exam.id, values);
      return guardRefusal(
        () =>
          record
            ? Services.examSubjects.updateExamSubject(record.id, input)
            : Services.examSubjects.createExamSubject(input),
        invalidateExams,
      );
    },
    knownFields: EXAM_SUBJECT_ERROR_FIELDS,
    onSuccess: () => {
      invalidateExams();
      toast.success(t("subjects.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={record ? t("subjects.form.editTitle") : t("subjects.form.createTitle")}
      description={t("subjects.form.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <ExamSubjectFormFields
        form={form}
        sessionId={exam.academic_session_id}
        isEdit={Boolean(record)}
      />
    </FormDialogLayout>
  );
}
