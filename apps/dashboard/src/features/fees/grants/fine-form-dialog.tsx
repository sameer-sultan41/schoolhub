"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
} from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { enumLabel } from "@/lib/enum-label";
import { Services } from "@/services";
import {
  FINE_ERROR_FIELDS,
  FINE_REASON_MAX,
  FINE_TYPES,
  FINES_QUERY_MODULE,
} from "@/services/modules/fines/fines-constant";
import { buildFineInput, defaultFineFormValues } from "@/services/modules/fines/fines-helper";
import { createFineFormSchema, type FineFormValues } from "@/services/modules/fines/fines.schema";
import { FINE_TYPE_LABEL_KEY } from "@/features/fees/shared/grant-labels";
import { GrantStudentField } from "./grant-student-field";
import { useGrantReferences } from "./use-grant-references";

export interface FineFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Raises a fine against one student. Its fee head is required and must be in the fine category
 * (the picker offers only those, and the server refuses any other under `fee_head`). A server
 * refusal shows under its field; any other is the form's message.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form.
 */
export function FineFormDialog({ open, onOpenChange }: FineFormDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(FINES_QUERY_MODULE);
  const references = useGrantReferences();

  const schema = useMemo(
    () =>
      createFineFormSchema({
        required: tCommon("requiredField"),
        invalidAmount: t("grants.form.errors.invalidAmount"),
      }),
    [t, tCommon],
  );
  const form = useForm<FineFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultFineFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: FineFormValues) => Services.fines.createFine(buildFineInput(values)),
    knownFields: FINE_ERROR_FIELDS,
    onSuccess: () => {
      invalidate();
      toast.success(t("grants.fines.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("grants.fines.form.createTitle")}
      description={t("grants.fines.form.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <GrantStudentField form={form} name="student" />
      <FormSelectField
        form={form}
        name="fee_head"
        label={t("grants.form.head")}
        placeholder={t("grants.form.selectHead")}
        options={references.fineHeads.map((head) => ({ id: head.id, name: head.name }))}
        description={
          !references.isLoading && references.fineHeads.length === 0
            ? t("grants.fines.form.noHeads")
            : undefined
        }
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormSelectField
          form={form}
          name="fine_type"
          label={t("grants.fines.form.type")}
          placeholder={t("grants.fines.form.type")}
          options={FINE_TYPES.map((type) => ({
            id: type,
            name: enumLabel(t, FINE_TYPE_LABEL_KEY, type),
          }))}
        />
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("grants.fines.form.amount")}</FormLabel>
              <FormControl>
                <Input inputMode="decimal" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="reason"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("grants.fines.form.reason")}</FormLabel>
            <FormControl>
              <Textarea rows={3} maxLength={FINE_REASON_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialogLayout>
  );
}
