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
import { Services, type ReportCardRecord, type ReportCardRemarkField } from "@/services";
import {
  REMARKS_MAX_LENGTH,
  REPORT_CARDS_QUERY_MODULE,
} from "@/services/modules/report-cards/report-cards-constant";
import { toRemarksBody } from "@/services/modules/report-cards/report-cards-helper";
import {
  createRemarksFormSchema,
  type RemarksFormValues,
} from "@/services/modules/report-cards/report-cards.schema";
import { guardRefusal } from "@/features/exams/guard-refusal";

export interface RemarksDialogProps {
  onOpenChange: (open: boolean) => void;
  /** An unpublished card. */
  card: ReportCardRecord;
  /** The remark fields the viewer may write (`writableRemarkFields`): at least one. */
  fields: readonly ReportCardRemarkField[];
}

/** The i18n key of each remark field's label and hint (`exams.reportCards.remarks.<key>`). */
const FIELD_COPY: Record<ReportCardRemarkField, "classTeacher" | "principal"> = {
  class_teacher_remarks: "classTeacher",
  principal_remarks: "principal",
};

/**
 * A card's remarks: only the fields the viewer may write are shown and sent (a class teacher's
 * remark needs `exams.report-card.create`, a principal's `.publish`), so nobody overwrites the
 * other's words. A field the server refuses (a 403 naming it) shows as the form's message; a card
 * published meanwhile (a 409) reloads the list and keeps the server's sentence.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts from the
 * card's saved remarks.
 */
export function RemarksDialog({ onOpenChange, card, fields }: RemarksDialogProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateCards = useInvalidateModule(REPORT_CARDS_QUERY_MODULE);

  const schema = useMemo(
    () => createRemarksFormSchema(t("reportCards.remarks.tooLong", { max: REMARKS_MAX_LENGTH })),
    [t],
  );
  const form = useForm<RemarksFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      class_teacher_remarks: card.class_teacher_remarks ?? "",
      principal_remarks: card.principal_remarks ?? "",
    },
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: RemarksFormValues) =>
      guardRefusal(
        () => Services.reportCards.updateRemarks(card.id, toRemarksBody(values, fields)),
        invalidateCards,
      ),
    knownFields: fields,
    onSuccess: () => {
      invalidateCards();
      toast.success(t("reportCards.remarks.done", { name: card.student_name }));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open
      onOpenChange={onOpenChange}
      title={t("reportCards.remarks.title", { name: card.student_name })}
      description={t("reportCards.remarks.description")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t("reportCards.remarks.submitting")}
    >
      {fields.map((name) => (
        <FormField
          key={name}
          control={form.control}
          name={name}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t(`reportCards.remarks.${FIELD_COPY[name]}.label`)}</FormLabel>
              <FormControl>
                <Textarea maxLength={REMARKS_MAX_LENGTH} {...field} />
              </FormControl>
              <FormDescription>{t(`reportCards.remarks.${FIELD_COPY[name]}.hint`)}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      ))}
    </FormDialogLayout>
  );
}
