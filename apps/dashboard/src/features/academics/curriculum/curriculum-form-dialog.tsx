"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { Services, type AcademicSessionSummary, type CurriculumRecord } from "@/services";
import {
  buildCurriculumInput,
  curriculumErrorFields,
  defaultCurriculumFormValues,
  recordToFormValues,
} from "@/services/modules/curriculum/curriculum-helper";
import {
  createCurriculumFormSchema,
  type CurriculumFormValues,
} from "@/services/modules/curriculum/curriculum.schema";
import { CurriculumFormFields } from "./curriculum-form-fields";
import { useInvalidateCurriculum } from "./use-invalidate-curriculum";

export interface CurriculumFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The mapping to edit; omitted to add a new one. */
  record?: CurriculumRecord;
  /** Add only: the sessions to choose from, and the one the form starts on. */
  sessions: AcademicSessionSummary[];
  sessionId: string;
}

/**
 * Adds a subject to a class's curriculum, or edits one mapping. An edit sends only the four
 * fields a mapping may change (`buildCurriculumInput`); the session, class, subject and campus
 * identify it and are shown read-only.
 *
 * Mounting contract: the caller mounts this only while it is open (`{open && <... />}`), so
 * every open is a fresh form with no reset logic. An edit also starts from the row the table
 * already holds, so there is no prefill after mount for a `Select` to blank on.
 */
export function CurriculumFormDialog({
  open,
  onOpenChange,
  record,
  sessions,
  sessionId,
}: CurriculumFormDialogProps) {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const invalidateCurriculum = useInvalidateCurriculum();

  // Zod can't reach next-intl, so the schema takes the translated messages.
  const schema = useMemo(
    () =>
      createCurriculumFormSchema({
        required: tCommon("requiredField"),
        electiveGroupRequired: t("curriculum.form.electiveGroupRequired"),
        weeklyPeriodsInvalid: t("curriculum.form.weeklyPeriodsInvalid"),
      }),
    [t, tCommon],
  );
  const form = useForm<CurriculumFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record ? recordToFormValues(record) : defaultCurriculumFormValues(sessionId),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: CurriculumFormValues) =>
      record
        ? Services.curriculum.updateCurriculum(record.id, buildCurriculumInput(values, "edit"))
        : Services.curriculum.createCurriculum(buildCurriculumInput(values, "create")),
    // Read at error time: the group input is gone once the switch is off.
    knownFields: () =>
      curriculumErrorFields(record ? "edit" : "create", form.getValues("is_elective")),
    onSuccess: () => {
      invalidateCurriculum();
      toast.success(t("curriculum.saved"));
      onOpenChange(false);
    },
    fallbackMessage: t("common.submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={record ? t("curriculum.form.editTitle") : t("curriculum.form.createTitle")}
      description={t("curriculum.form.description")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t("curriculum.form.submitting")}
    >
      <CurriculumFormFields form={form} record={record} sessions={sessions} />
    </FormDialogLayout>
  );
}
