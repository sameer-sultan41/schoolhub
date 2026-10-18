"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { Services, type PromotionDecisionRecord } from "@/services";
import {
  OVERRIDE_REASON_MAX,
  PROMOTION_DECISION_FIELDS,
  REMARKS_MAX,
} from "@/services/modules/promotions/promotions-constant";
import {
  buildDecisionUpdate,
  decisionToFormValues,
  hasDecisionChanges,
  readPromotionProposal,
} from "@/services/modules/promotions/promotions-helper";
import {
  createPromotionDecisionFormSchema,
  type PromotionDecisionFormValues,
} from "@/services/modules/promotions/promotions.schema";
import { PromotionDecisionFields } from "./promotion-decision-fields";
import { usePromotionBatchCache } from "./use-promotion-batch-cache";

export interface PromotionDecisionDialogProps {
  batchId: string;
  /** The row to edit, as the batch detail has it. */
  decision: PromotionDecisionRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Edits one student's decision in a draft batch. Only what changed is sent (nothing: no request,
 * the dialog just closes). A refusal stays in the dialog, under the field it names or above the
 * form; a `409` (the batch is no longer a draft) also reloads the batch, so the page behind
 * stops offering Edit.
 *
 * Mounting contract: the caller mounts this only while it is open, so each open starts from the
 * row as it was.
 */
export function PromotionDecisionDialog({
  batchId,
  decision,
  open,
  onOpenChange,
}: PromotionDecisionDialogProps) {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const { refreshBatch, refreshOnConflict } = usePromotionBatchCache(batchId);

  const schema = useMemo(
    () =>
      createPromotionDecisionFormSchema({
        required: tCommon("requiredField"),
        overrideReasonTooLong: t("promotions.decision.tooLong", { max: OVERRIDE_REASON_MAX }),
        remarksTooLong: t("promotions.decision.tooLong", { max: REMARKS_MAX }),
      }),
    [t, tCommon],
  );
  // What the form opened with: the edit is the difference from it.
  const initialValues = useMemo(() => decisionToFormValues(decision), [decision]);
  const proposal = useMemo(
    () => readPromotionProposal(decision.decision_basis),
    [decision.decision_basis],
  );
  const form = useForm<PromotionDecisionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: async (values: PromotionDecisionFormValues) => {
      const update = buildDecisionUpdate(values, initialValues);
      if (!hasDecisionChanges(update)) return undefined;
      return refreshOnConflict(() =>
        Services.promotions.updateDecision(batchId, decision.student_id, update),
      );
    },
    knownFields: PROMOTION_DECISION_FIELDS,
    onSuccess: (saved) => {
      if (saved !== undefined) refreshBatch();
      onOpenChange(false);
    },
    fallbackMessage: t("common.submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("promotions.decision.title")}
      description={t("promotions.decision.description", { student: decision.student_name })}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t("promotions.decision.submitting")}
    >
      <PromotionDecisionFields form={form} decision={decision} proposal={proposal} />
    </FormDialogLayout>
  );
}
