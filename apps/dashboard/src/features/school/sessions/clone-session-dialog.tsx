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
} from "@/services/modules/school-organization/school-organization-helper";
import {
  createSessionFormSchema,
  type SessionFormValues,
} from "@/services/modules/school-organization/school-organization.schema";
import { SessionFields } from "./session-fields";

export interface CloneSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The session whose curriculum the new one starts from. */
  source: AcademicSessionRecord;
}

/**
 * Starts next year from `source` (`:clone`): a new planned session with the name and dates
 * given, and `source`'s curriculum copied into it. Terms are not copied, since their dates
 * rarely carry over, so the copy says to add them. Dates overlapping another session are
 * refused with the server's own sentence.
 *
 * A form, so it is `FormDialogLayout` + `useFormDialogSubmit` rather than `useConfirmAction`
 * (which is for a confirm with no inputs): a refusal that names a field shows under it.
 *
 * Mounting contract: the caller mounts this only while it is open.
 */
export function CloneSessionDialog({ open, onOpenChange, source }: CloneSessionDialogProps) {
  const t = useTranslations("school");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(SCHOOL_ORGANIZATION_QUERY_MODULE);
  const messages = useStructureFormMessages();

  const schema = useMemo(() => createSessionFormSchema(messages), [messages]);
  const form = useForm<SessionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultSessionFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: SessionFormValues) =>
      Services.schoolOrganization.cloneSession(source.id, buildSessionInput(values)),
    knownFields: SESSION_ERROR_FIELDS,
    onSuccess: (created) => {
      invalidate();
      toast.success(t("sessions.clone.done", { name: created.name, source: source.name }));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("sessions.clone.title", { name: source.name })}
      description={t("sessions.clone.description")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
      submitLabel={t("sessions.actions.clone")}
    >
      <SessionFields form={form} />
    </FormDialogLayout>
  );
}
