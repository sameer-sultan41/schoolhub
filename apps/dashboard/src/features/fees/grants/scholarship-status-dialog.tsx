"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormControl, FormField, FormItem, FormLabel, FormMessage, Textarea } from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { enumLabel } from "@/lib/enum-label";
import { Services, type ScholarshipRecord, type ScholarshipStatus } from "@/services";
import {
  SCHOLARSHIP_NOTES_MAX,
  SCHOLARSHIP_STATUS_ERROR_FIELDS,
  SCHOLARSHIPS_QUERY_MODULE,
} from "@/services/modules/scholarships/scholarships-constant";
import { scholarshipNotesRequired } from "@/services/modules/scholarships/scholarships-helper";
import {
  createScholarshipStatusFormSchema,
  type ScholarshipStatusFormValues,
} from "@/services/modules/scholarships/scholarships.schema";
import {
  SCHOLARSHIP_ACTION_LABEL_KEY,
  SCHOLARSHIP_STATUS_LABEL_KEY,
} from "@/features/fees/shared/grant-labels";

export interface ScholarshipStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scholarship: ScholarshipRecord;
  /** The status being moved to: one the lifecycle allows from the award's current one. */
  to: ScholarshipStatus;
}

/**
 * Moves an award to its next status with a PATCH of `status`. Ending or revoking is final and
 * asks for the required `notes`; the other moves take optional notes, sent only when typed, so
 * existing notes are never blanked. A server refusal (an illegal move on `status`, or missing
 * notes) shows inline and the dialog stays open.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form.
 */
export function ScholarshipStatusDialog({
  open,
  onOpenChange,
  scholarship,
  to,
}: ScholarshipStatusDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(SCHOLARSHIPS_QUERY_MODULE);
  const notesRequired = scholarshipNotesRequired(to);
  const current = scholarship.status ?? "applied";

  const schema = useMemo(
    () => createScholarshipStatusFormSchema({ required: tCommon("requiredField") }, notesRequired),
    [tCommon, notesRequired],
  );
  const form = useForm<ScholarshipStatusFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { notes: "" },
  });

  const action = enumLabel(t, SCHOLARSHIP_ACTION_LABEL_KEY, to);
  const toLabel = enumLabel(t, SCHOLARSHIP_STATUS_LABEL_KEY, to);

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: ScholarshipStatusFormValues) =>
      Services.scholarships.updateScholarship(scholarship.id, {
        status: to,
        notes: values.notes.trim() || undefined,
      }),
    knownFields: SCHOLARSHIP_STATUS_ERROR_FIELDS,
    onSuccess: () => {
      invalidate();
      toast.success(
        t("grants.scholarships.statusDialog.done", { name: scholarship.name, to: toLabel }),
      );
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("grants.scholarships.statusDialog.title", { action, name: scholarship.name })}
      description={t(
        notesRequired
          ? "grants.scholarships.statusDialog.introFinal"
          : "grants.scholarships.statusDialog.intro",
        { from: enumLabel(t, SCHOLARSHIP_STATUS_LABEL_KEY, current), to: toLabel },
      )}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
      submitLabel={t("grants.scholarships.statusDialog.submit")}
    >
      <FormField
        control={form.control}
        name="notes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              {t(
                notesRequired
                  ? "grants.scholarships.statusDialog.notesRequired"
                  : "grants.scholarships.statusDialog.notes",
              )}
            </FormLabel>
            <FormControl>
              <Textarea rows={3} maxLength={SCHOLARSHIP_NOTES_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialogLayout>
  );
}
