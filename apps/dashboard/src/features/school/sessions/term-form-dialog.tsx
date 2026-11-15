"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { TextFormField } from "@/features/school/shared/text-form-field";
import { useStructureFormMessages } from "@/features/school/shared/use-structure-form-messages";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type AcademicSessionRecord, type TermRecord } from "@/services";
import {
  SCHOOL_ORGANIZATION_QUERY_MODULE,
  TERM_ERROR_FIELDS,
  TERM_NAME_MAX,
} from "@/services/modules/school-organization/school-organization-constant";
import {
  buildTermInput,
  defaultTermFormValues,
  recordToTermFormValues,
} from "@/services/modules/school-organization/school-organization-helper";
import {
  createTermFormSchema,
  type TermFormValues,
} from "@/services/modules/school-organization/school-organization.schema";

export interface TermFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: AcademicSessionRecord;
  /** The term to edit; omitted to add one. */
  record?: TermRecord;
  /** A new term's suggested order: after the session's last term. */
  nextSequence: number;
}

/**
 * Adds a term to `session`, or edits one. The server keeps a term inside its session's dates
 * and off its siblings' (`assert_term_window`): an overlap names the term it overlaps, and that
 * sentence is the form's own message. A closed session's terms are refused the same way.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * form.
 */
export function TermFormDialog({
  open,
  onOpenChange,
  session,
  record,
  nextSequence,
}: TermFormDialogProps) {
  const t = useTranslations("school");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(SCHOOL_ORGANIZATION_QUERY_MODULE);
  const messages = useStructureFormMessages();

  const schema = useMemo(() => createTermFormSchema(messages), [messages]);
  const form = useForm<TermFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record ? recordToTermFormValues(record) : defaultTermFormValues(nextSequence),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: TermFormValues) =>
      record
        ? Services.schoolOrganization.updateTerm(record.id, buildTermInput(values))
        : Services.schoolOrganization.createTerm({
            ...buildTermInput(values),
            academic_session_id: session.id,
          }),
    knownFields: TERM_ERROR_FIELDS,
    onSuccess: () => {
      invalidate();
      toast.success(t("terms.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={
        record ? t("terms.form.editTitle") : t("terms.form.createTitle", { session: session.name })
      }
      description={t("terms.form.description")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextFormField form={form} name="name" label={t("fields.name")} maxLength={TERM_NAME_MAX} />
        <TextFormField
          form={form}
          name="sequence"
          label={t("terms.fields.sequence")}
          description={t("terms.form.sequenceHint")}
        />
        <TextFormField form={form} name="start_date" type="date" label={t("fields.startDate")} />
        <TextFormField form={form} name="end_date" type="date" label={t("fields.endDate")} />
      </div>
    </FormDialogLayout>
  );
}
