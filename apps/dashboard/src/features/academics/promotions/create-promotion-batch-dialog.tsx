"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import { promotionBatchPath } from "@/config/paths";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useClasses } from "@/hooks/use-reference-data";
import { queryKeys } from "@/lib/query-client";
import { Services, type AcademicSessionSummary } from "@/services";
import {
  PROMOTION_BATCHES_RESOURCE,
  PROMOTION_CREATE_FIELDS,
  PROMOTION_QUERY_MODULE,
} from "@/services/modules/promotions/promotions-constant";
import { toCreateBatchInput } from "@/services/modules/promotions/promotions-helper";
import {
  createPromotionBatchFormSchema,
  type PromotionBatchFormValues,
} from "@/services/modules/promotions/promotions.schema";
import { LOCKED_SESSION_STATUSES } from "@/services/modules/school-organization/school-organization-constant";

export interface CreatePromotionBatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: AcademicSessionSummary[];
  /** The current session's id: the batch's default "from" session. `""` when there is none. */
  currentSessionId: string;
}

/** Mounting contract: the caller mounts this only while it is open, so each open starts fresh. */
export function CreatePromotionBatchDialog({
  open,
  onOpenChange,
  sessions,
  currentSessionId,
}: CreatePromotionBatchDialogProps) {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const queryClient = useQueryClient();
  // Only classes still offered: a batch moves a class's current students up.
  const classesQuery = useClasses({ isActive: true });

  const schema = useMemo(() => createPromotionBatchFormSchema(tCommon("requiredField")), [tCommon]);
  const form = useForm<PromotionBatchFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      from_academic_session_id: currentSessionId,
      to_academic_session_id: "",
      class_id: "",
    },
  });
  const fromSessionId = useWatch({ control: form.control, name: "from_academic_session_id" });

  // The target can't be the source, and a closed or archived session is read-only, so the
  // server would refuse it: offer neither.
  const targets = sessions.filter(
    (session) => session.id !== fromSessionId && !LOCKED_SESSION_STATUSES.includes(session.status),
  );

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: PromotionBatchFormValues) =>
      Services.promotions.createPromotionBatch(toCreateBatchInput(values)),
    knownFields: PROMOTION_CREATE_FIELDS,
    onSuccess: (created) => {
      // The list prefix only: the bare module key would also refetch a running execute poll.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.list(PROMOTION_QUERY_MODULE, PROMOTION_BATCHES_RESOURCE),
      });
      toast.success(t("promotions.created", { students: created.students }));
      onOpenChange(false);
      router.push(promotionBatchPath(created.batch_id));
    },
    fallbackMessage: t("common.submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("promotions.form.createTitle")}
      description={t("promotions.form.description")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t("promotions.form.submitting")}
      submitLabel={t("promotions.form.submit")}
    >
      <FormSelectField
        form={form}
        name="from_academic_session_id"
        label={t("promotions.fields.fromSession")}
        placeholder={t("fields.selectSession")}
        options={sessions}
        // The target can't also be the source: clear it when the source moves onto it.
        onPick={(sessionId) => {
          if (form.getValues("to_academic_session_id") === sessionId) {
            form.setValue("to_academic_session_id", "");
          }
        }}
      />
      <FormSelectField
        form={form}
        name="to_academic_session_id"
        label={t("promotions.fields.toSession")}
        placeholder={t("fields.selectSession")}
        options={targets}
      />
      <FormSelectField
        form={form}
        name="class_id"
        label={t("fields.class")}
        placeholder={t("fields.selectClass")}
        options={classesQuery.data ?? []}
      />
    </FormDialogLayout>
  );
}
