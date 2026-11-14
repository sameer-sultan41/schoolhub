"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type QuestionBankRecord } from "@/services";
import {
  BANK_ERROR_FIELDS,
  QUESTION_BANKS_QUERY_MODULE,
} from "@/services/modules/question-banks/question-banks-constant";
import {
  buildBankInput,
  defaultBankFormValues,
  recordToBankFormValues,
} from "@/services/modules/question-banks/question-banks-helper";
import {
  createBankFormSchema,
  type BankFormValues,
} from "@/services/modules/question-banks/question-banks.schema";
import { QuestionBankFormFields } from "./question-bank-form-fields";

export interface QuestionBankFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The bank to edit; omitted to add one. */
  record?: QuestionBankRecord;
}

/**
 * Adds a question bank, or edits one. A server error that names a field is shown under it; any
 * other is the form's own message.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * form. An edit starts from the record the caller holds, so no prefill lands after mount.
 */
export function QuestionBankFormDialog({
  open,
  onOpenChange,
  record,
}: QuestionBankFormDialogProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateBanks = useInvalidateModule(QUESTION_BANKS_QUERY_MODULE);

  const schema = useMemo(
    () => createBankFormSchema({ required: tCommon("requiredField") }),
    [tCommon],
  );
  const form = useForm<BankFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record ? recordToBankFormValues(record) : defaultBankFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: BankFormValues) =>
      record
        ? Services.questionBanks.updateBank(record.id, buildBankInput(values))
        : Services.questionBanks.createBank(buildBankInput(values)),
    knownFields: BANK_ERROR_FIELDS,
    onSuccess: () => {
      invalidateBanks();
      toast.success(t("questionBanks.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={record ? t("questionBanks.form.editTitle") : t("questionBanks.form.createTitle")}
      description={t("questionBanks.form.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <QuestionBankFormFields form={form} />
    </FormDialogLayout>
  );
}
