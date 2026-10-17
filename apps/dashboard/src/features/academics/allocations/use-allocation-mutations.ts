"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { queryKeys } from "@/lib/query-client";
import type { AllocationSaveResult } from "@/services";
import { ALLOCATION_QUERY_MODULE } from "@/services/modules/teacher-allocations/teacher-allocations-constant";
import { allocationErrorFields } from "@/services/modules/teacher-allocations/teacher-allocations-helper";

/**
 * After an accepted write: refresh `teacher-allocations` (list, load panel, dashboard widget),
 * toast it, and warn if the teacher is now over the norm (advisory: the write stands).
 */
function useNotifySaved() {
  const t = useTranslations("academics");
  const queryClient = useQueryClient();

  return (message: string, result?: AllocationSaveResult) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.module(ALLOCATION_QUERY_MODULE) });
    toast.success(message);
    const warning = result?.warnings[0];
    if (warning) {
      toast.warning(
        t("allocations.overNormWarning", { periods: warning.weekly_periods, norm: warning.norm }),
      );
    }
  };
}

interface FormSubmitOptions<TValues extends FieldValues> {
  form: UseFormReturn<TValues>;
  /** `create` shows every identity field, `edit` only the editable ones. */
  mode: "create" | "edit";
  /** Resolves `undefined` when there was nothing to save: the dialog closes, silently. */
  save: (values: TValues) => Promise<AllocationSaveResult | undefined>;
  onSaved: () => void;
}

/** `useFormDialogSubmit` for an allocation form, plus the allocation write's notifications. */
export function useAllocationFormSubmit<TValues extends FieldValues>({
  form,
  mode,
  save,
  onSaved,
}: FormSubmitOptions<TValues>) {
  const t = useTranslations("academics");
  const notifySaved = useNotifySaved();

  return useFormDialogSubmit({
    form,
    mutationFn: save,
    knownFields: () => allocationErrorFields(mode),
    onSuccess: (result) => {
      if (result) notifySaved(t("allocations.saved"), result);
      onSaved();
    },
    fallbackMessage: t("common.submitFailed"),
  });
}

interface ActionOptions {
  /** Resolves with the saved allocation and its warnings, or `undefined` for a removal. */
  run: () => Promise<AllocationSaveResult | undefined>;
  /** Already translated: the toast on success. */
  successMessage: string;
  onDone: () => void;
}

/** `useConfirmAction` for an allocation action with no form (End, Reinstate, Remove). */
export function useAllocationAction({ run, successMessage, onDone }: ActionOptions) {
  const t = useTranslations("academics");
  const notifySaved = useNotifySaved();

  return useConfirmAction({
    mutationFn: run,
    onSuccess: (result) => {
      notifySaved(successMessage, result);
      onDone();
    },
    fallbackMessage: t("common.submitFailed"),
  });
}
