"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { foldUnknownFieldErrors, NON_FIELD, resolveErrorMessage } from "@/lib/error-message";

export interface ConfirmActionOptions<TResult> {
  mutationFn: () => Promise<TResult>;
  onSuccess: (result: TResult) => void;
  /** Shown when the failure is not an API error. */
  fallbackMessage: string;
}

/**
 * The action behind a confirm dialog that has no form: the server's refusal comes back as one
 * message to show inline (the dialog stays open), cleared when the action is tried again. A
 * refusal can name any field, and such a dialog has none, so every field detail folds into it.
 */
export function useConfirmAction<TResult>({
  mutationFn,
  onSuccess,
  fallbackMessage,
}: ConfirmActionOptions<TResult>) {
  const tErrors = useTranslations("errors");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn,
    onSuccess: (result) => {
      onSuccess(result);
    },
    onError: (mutationError) => {
      setError(
        resolveErrorMessage(
          foldUnknownFieldErrors(mutationError),
          tErrors,
          fallbackMessage,
          NON_FIELD,
        ),
      );
    },
  });

  function confirm() {
    setError(null);
    mutation.mutate();
  }

  return { error, isPending: mutation.isPending, confirm };
}
