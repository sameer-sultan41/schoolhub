"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type QuestionRecord } from "@/services";
import {
  QUESTION_BANKS_QUERY_MODULE,
  QUESTION_ERROR_FIELDS,
} from "@/services/modules/question-banks/question-banks-constant";
import {
  buildQuestionInput,
  defaultQuestionFormValues,
  recordToQuestionFormValues,
} from "@/services/modules/question-banks/question-banks-helper";
import {
  createQuestionFormSchema,
  type QuestionFormValues,
} from "@/services/modules/question-banks/question-banks.schema";
import { QuestionFormFields } from "./question-form-fields";

export interface QuestionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bankId: string;
  /** The question to edit; omitted to add one. */
  record?: QuestionRecord;
}

/**
 * Adds a question to the bank, or edits one. A question written here is the teacher's own, so
 * it is usable at once; an AI draft keeps its source and its approval on edit. A server error
 * that names a field is shown under it; any other is the form's own message.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * form. An edit starts from the row the table holds, so no prefill lands after mount.
 */
export function QuestionFormDialog({
  open,
  onOpenChange,
  bankId,
  record,
}: QuestionFormDialogProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateBanks = useInvalidateModule(QUESTION_BANKS_QUERY_MODULE);

  const schema = useMemo(
    () =>
      createQuestionFormSchema({
        required: tCommon("requiredField"),
        marksInvalid: t("questionBanks.questions.form.marksInvalid"),
        optionsNeeded: t("questionBanks.questions.form.optionsNeeded"),
      }),
    [t, tCommon],
  );
  const form = useForm<QuestionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record ? recordToQuestionFormValues(record) : defaultQuestionFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: QuestionFormValues) =>
      record
        ? Services.questionBanks.updateQuestion(bankId, record.id, buildQuestionInput(values))
        : Services.questionBanks.createQuestion(bankId, buildQuestionInput(values)),
    knownFields: QUESTION_ERROR_FIELDS,
    onSuccess: () => {
      invalidateBanks();
      toast.success(t("questionBanks.questions.saved"));
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
          ? t("questionBanks.questions.form.editTitle")
          : t("questionBanks.questions.form.createTitle")
      }
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <QuestionFormFields form={form} />
    </FormDialogLayout>
  );
}
