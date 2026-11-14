"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type FeeHeadRecord } from "@/services";
import {
  FEE_HEAD_ERROR_FIELDS,
  FEE_HEADS_QUERY_MODULE,
} from "@/services/modules/fee-heads/fee-heads-constant";
import {
  buildFeeHeadInput,
  defaultFeeHeadFormValues,
  recordToFeeHeadFormValues,
} from "@/services/modules/fee-heads/fee-heads-helper";
import {
  createFeeHeadFormSchema,
  type FeeHeadFormValues,
} from "@/services/modules/fee-heads/fee-heads.schema";
import { FeeHeadFormFields } from "./fee-head-form-fields";

export interface FeeHeadFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The head to edit; omitted to add one. */
  record?: FeeHeadRecord;
}

/**
 * Adds a fee head, or edits one. A server error that names a field is shown under it (an account
 * that is not income lands under the account select); any other is the form's own message.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * form. An edit starts from the record the caller holds, so no prefill lands after mount.
 */
export function FeeHeadFormDialog({ open, onOpenChange, record }: FeeHeadFormDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidateHeads = useInvalidateModule(FEE_HEADS_QUERY_MODULE);

  const schema = useMemo(
    () => createFeeHeadFormSchema({ required: tCommon("requiredField") }),
    [tCommon],
  );
  const form = useForm<FeeHeadFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record ? recordToFeeHeadFormValues(record) : defaultFeeHeadFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: FeeHeadFormValues) =>
      record
        ? Services.feeHeads.updateFeeHead(record.id, buildFeeHeadInput(values))
        : Services.feeHeads.createFeeHead(buildFeeHeadInput(values)),
    knownFields: FEE_HEAD_ERROR_FIELDS,
    onSuccess: () => {
      invalidateHeads();
      toast.success(t("heads.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={record ? t("heads.form.editTitle") : t("heads.form.createTitle")}
      description={t("heads.form.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <FeeHeadFormFields form={form} />
    </FormDialogLayout>
  );
}
