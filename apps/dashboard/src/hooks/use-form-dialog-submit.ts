"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import { useGuardedSubmit, useSubmitGuard } from "@/hooks/use-submit-guard";
import { applyServerFieldErrors, foldUnknownFieldErrors } from "@/lib/error-message";

export interface FormDialogSubmitOptions<TValues extends FieldValues, TResult> {
  form: UseFormReturn<TValues>;
  mutationFn: (values: TValues) => Promise<TResult>;
  /**
   * The fields that have an input to show an error under, as a list or a function read at
   * error time (an input can be gone by then). A server error on any other field shows as the
   * form's own message, never swallowed.
   */
  knownFields: readonly string[] | (() => readonly string[]);
  onSuccess: (result: TResult, values: TValues) => void;
  /** Shown when the failure is not an API error. */
  fallbackMessage: string;
}

/**
 * The submit of a form dialog: guarded against a double submit, a server 422/400 kept inline
 * (the dialog stays open) under the field it names or as the form's own message, which clears
 * at the start of each attempt.
 */
export function useFormDialogSubmit<TValues extends FieldValues, TResult>({
  form,
  mutationFn,
  knownFields,
  onSuccess,
  fallbackMessage,
}: FormDialogSubmitOptions<TValues, TResult>) {
  const tErrors = useTranslations("errors");
  const submitGuard = useSubmitGuard();
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn,
    onSuccess: (result, values) => {
      onSuccess(result, values);
    },
    onError: (error) => {
      const fields = typeof knownFields === "function" ? knownFields() : knownFields;
      applyServerFieldErrors({
        error: foldUnknownFieldErrors(error, fields),
        form,
        knownFields: fields,
        tErrors,
        fallback: fallbackMessage,
        setFormError,
      });
    },
  });

  const handleSubmit = useGuardedSubmit(form, submitGuard, (values) => {
    setFormError(null);
    return new Promise<void>((resolve) => {
      mutation.mutate(values, {
        onSettled: () => {
          resolve();
        },
      });
    });
  });

  return { handleSubmit, formError, isPending: mutation.isPending };
}
