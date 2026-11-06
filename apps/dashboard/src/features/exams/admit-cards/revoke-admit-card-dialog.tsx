"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
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
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type AdmitCardRecord } from "@/services";
import {
  ADMIT_CARDS_QUERY_MODULE,
  REVOKE_ERROR_FIELDS,
  REVOKE_REASON_MAX_LENGTH,
} from "@/services/modules/admit-cards/admit-cards-constant";
import {
  createRevokeFormSchema,
  type RevokeFormValues,
} from "@/services/modules/admit-cards/admit-cards.schema";
import { guardRefusal } from "@/features/exams/guard-refusal";

export interface RevokeAdmitCardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A live (not yet revoked) card. */
  card: AdmitCardRecord;
}

/**
 * Revokes a card with a reason (§5.3): the reason is required here, by the server and by a CHECK
 * constraint. A revoked card has no download, and a later issue run does not reinstate it. A card
 * revoked meanwhile (a 409) reloads the list and keeps the server's sentence.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts blank.
 */
export function RevokeAdmitCardDialog({ open, onOpenChange, card }: RevokeAdmitCardDialogProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateCards = useInvalidateModule(ADMIT_CARDS_QUERY_MODULE);

  const schema = useMemo(
    () =>
      createRevokeFormSchema({
        required: t("admitCards.revoke.required"),
        tooLong: t("admitCards.revoke.tooLong", { max: REVOKE_REASON_MAX_LENGTH }),
      }),
    [t],
  );
  const form = useForm<RevokeFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { reason: "" },
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: RevokeFormValues) =>
      guardRefusal(
        () => Services.admitCards.revokeAdmitCard(card.id, values.reason),
        invalidateCards,
      ),
    knownFields: REVOKE_ERROR_FIELDS,
    onSuccess: () => {
      invalidateCards();
      toast.success(t("admitCards.revoke.done", { name: card.student_name }));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("admitCards.revoke.title", { name: card.student_name })}
      description={t("admitCards.revoke.description", { number: card.admit_card_no })}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t("admitCards.revoke.submitting")}
      submitLabel={t("admitCards.revoke.submit")}
    >
      <FormField
        control={form.control}
        name="reason"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("admitCards.revoke.reason")}</FormLabel>
            <FormControl>
              <Textarea maxLength={REVOKE_REASON_MAX_LENGTH} {...field} />
            </FormControl>
            <FormDescription>{t("admitCards.revoke.reasonHint")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialogLayout>
  );
}
