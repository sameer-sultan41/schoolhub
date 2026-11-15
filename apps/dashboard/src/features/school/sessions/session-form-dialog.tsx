"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useStructureFormMessages } from "@/features/school/shared/use-structure-form-messages";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type AcademicSessionRecord } from "@/services";
import {
  SCHOOL_ORGANIZATION_QUERY_MODULE,
  SESSION_ERROR_FIELDS,
} from "@/services/modules/school-organization/school-organization-constant";
import {
  buildSessionInput,
  defaultSessionFormValues,
  recordToSessionFormValues,
} from "@/services/modules/school-organization/school-organization-helper";
import {
  createSessionFormSchema,
  type SessionFormValues,
} from "@/services/modules/school-organization/school-organization.schema";
import { SessionFields } from "./session-fields";

export interface SessionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The session to edit; omitted to add one. */
  record?: AcademicSessionRecord;
}

/**
 * Adds a session (planned until it is activated), or edits one's name and dates. The server
 * refuses dates that overlap another session; that sentence is the form's own message.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * form.
 */
export function SessionFormDialog({ open, onOpenChange, record }: SessionFormDialogProps) {
  const t = useTranslations("school");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(SCHOOL_ORGANIZATION_QUERY_MODULE);
  const messages = useStructureFormMessages();

  const schema = useMemo(() => createSessionFormSchema(messages), [messages]);
  const form = useForm<SessionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record ? recordToSessionFormValues(record) : defaultSessionFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: SessionFormValues) =>
      record
        ? Services.schoolOrganization.updateSession(record.id, buildSessionInput(values))
        : Services.schoolOrganization.createSession(buildSessionInput(values)),
    knownFields: SESSION_ERROR_FIELDS,
    onSuccess: () => {
      invalidate();
      toast.success(t("sessions.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={record ? t("sessions.form.editTitle") : t("sessions.form.createTitle")}
      description={t("sessions.form.description")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <SessionFields form={form} />
    </FormDialogLayout>
  );
}
