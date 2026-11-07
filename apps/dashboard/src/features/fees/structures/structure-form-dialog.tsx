"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type FeeStructureRecord } from "@/services";
import {
  FEE_STRUCTURE_ERROR_FIELDS,
  FEE_STRUCTURES_QUERY_MODULE,
} from "@/services/modules/fee-structures/fee-structures-constant";
import {
  buildFeeStructureInput,
  defaultFeeStructureFormValues,
  recordToFeeStructureFormValues,
} from "@/services/modules/fee-structures/fee-structures-helper";
import {
  createFeeStructureFormSchema,
  type FeeStructureFormValues,
} from "@/services/modules/fee-structures/fee-structures.schema";
import { StructureFormFields } from "./structure-form-fields";

export interface StructureFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The structure to edit; omitted to add one. */
  record?: FeeStructureRecord;
  /** After a structure is created: the list opens its page. Not called for an edit. */
  onCreated?: (record: FeeStructureRecord) => void;
}

/**
 * Adds a fee structure (a draft), or edits one. A server error that names a field is shown under
 * it (a closed session lands under the session select); any other is the form's own message.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * form. An edit starts from the record the caller holds, so no prefill lands after mount.
 */
export function StructureFormDialog({
  open,
  onOpenChange,
  record,
  onCreated,
}: StructureFormDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidateStructures = useInvalidateModule(FEE_STRUCTURES_QUERY_MODULE);

  const schema = useMemo(
    () => createFeeStructureFormSchema({ required: tCommon("requiredField") }),
    [tCommon],
  );
  const form = useForm<FeeStructureFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record
      ? recordToFeeStructureFormValues(record)
      : defaultFeeStructureFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: FeeStructureFormValues) =>
      record
        ? Services.feeStructures.updateFeeStructure(record.id, buildFeeStructureInput(values))
        : Services.feeStructures.createFeeStructure(buildFeeStructureInput(values)),
    knownFields: FEE_STRUCTURE_ERROR_FIELDS,
    onSuccess: (saved) => {
      invalidateStructures();
      toast.success(t("structures.saved"));
      onOpenChange(false);
      if (!record) onCreated?.(saved);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={record ? t("structures.form.editTitle") : t("structures.form.createTitle")}
      description={t("structures.form.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <StructureFormFields form={form} />
    </FormDialogLayout>
  );
}
