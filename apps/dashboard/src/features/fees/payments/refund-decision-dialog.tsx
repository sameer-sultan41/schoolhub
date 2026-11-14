"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormControl, FormField, FormItem, FormLabel, FormMessage, Textarea } from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { formatMoney } from "@/lib/format-decimal";
import { Services, type RefundRecord } from "@/services";
import {
  REFUND_DECISION_ERROR_FIELDS,
  REFUND_NOTE_MAX,
  REFUNDS_QUERY_MODULE,
  type RefundDecision,
} from "@/services/modules/refunds/refunds-constant";
import { buildRefundDecisionInput } from "@/services/modules/refunds/refunds-helper";
import {
  createRefundDecisionFormSchema,
  type RefundDecisionFormValues,
} from "@/services/modules/refunds/refunds.schema";

export interface RefundDecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refund: RefundRecord;
  decision: RefundDecision;
}

/**
 * Approves or rejects a requested refund. The note is optional on approval and asked for on a
 * rejection. The server's refusals stay inline: the requester deciding their own refund (a 422
 * under `approved_by`, shown as the dialog's message since no input carries it) and a refund
 * someone else already decided. The tab's list reloads on success.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form.
 */
export function RefundDecisionDialog({
  open,
  onOpenChange,
  refund,
  decision,
}: RefundDecisionDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const invalidate = useInvalidateModule(REFUNDS_QUERY_MODULE);
  const amount = formatMoney(locale, refund.amount);

  const schema = useMemo(
    () =>
      createRefundDecisionFormSchema({ required: tCommon("requiredField") }, decision === "reject"),
    [tCommon, decision],
  );
  const form = useForm<RefundDecisionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { note: "" },
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: RefundDecisionFormValues) => {
      const input = buildRefundDecisionInput(values);
      return decision === "approve"
        ? Services.refunds.approveRefund(refund.id, input)
        : Services.refunds.rejectRefund(refund.id, input);
    },
    knownFields: REFUND_DECISION_ERROR_FIELDS,
    onSuccess: () => {
      invalidate();
      toast.success(t(`payments.refunds.${decision}.done`, { amount }));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t(`payments.refunds.${decision}.title`, { amount })}
      description={t(`payments.refunds.${decision}.intro`, { reason: refund.reason })}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
      submitLabel={t(`payments.refunds.${decision}.submit`)}
    >
      <FormField
        control={form.control}
        name="note"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              {t(decision === "reject" ? "payments.refunds.noteRequired" : "payments.refunds.note")}
            </FormLabel>
            <FormControl>
              <Textarea rows={3} maxLength={REFUND_NOTE_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialogLayout>
  );
}
