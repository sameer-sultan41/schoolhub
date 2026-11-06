"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Textarea,
} from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { REASON_ERROR_FIELDS } from "@/services/modules/exam-results/exam-results-constant";
import {
  createReasonFormSchema,
  type ReasonFormValues,
} from "@/services/modules/exam-results/exam-results.schema";

export interface ReasonDialogCopy {
  title: string;
  description: string;
  hint: string;
  submit: string;
  submitting: string;
}

export interface ReasonDialogProps<TResult> {
  onOpenChange: (open: boolean) => void;
  copy: ReasonDialogCopy;
  /** The server's `max_length` for this action's reason. */
  maxLength: number;
  submit: (reason: string) => Promise<TResult>;
  onDone: (result: TResult) => void;
}

/**
 * A results action that takes a required reason (withhold one result, send the results back).
 * The server's refusal stays inline under the reason or above the form.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts blank.
 */
export function ReasonDialog<TResult>({
  onOpenChange,
  copy,
  maxLength,
  submit,
  onDone,
}: ReasonDialogProps<TResult>) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");

  const schema = useMemo(
    () =>
      createReasonFormSchema(maxLength, {
        required: t("results.reason.required"),
        tooLong: t("results.reason.tooLong", { max: maxLength }),
      }),
    [maxLength, t],
  );
  const form = useForm<ReasonFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { reason: "" },
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: ReasonFormValues) => submit(values.reason),
    knownFields: REASON_ERROR_FIELDS,
    onSuccess: (result: TResult) => {
      onDone(result);
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open
      onOpenChange={onOpenChange}
      title={copy.title}
      description={copy.description}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={copy.submitting}
      submitLabel={copy.submit}
    >
      <FormField
        control={form.control}
        name="reason"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("results.reason.label")}</FormLabel>
            <FormControl>
              <Textarea maxLength={maxLength} {...field} />
            </FormControl>
            <FormDescription>{copy.hint}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialogLayout>
  );
}
