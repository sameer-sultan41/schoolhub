"use client";

import { useMemo, useRef } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { Services, type AcademicSessionSummary } from "@/services";
import {
  createCloneCurriculumFormSchema,
  type CloneCurriculumFormValues,
} from "@/services/modules/curriculum/curriculum.schema";
import { LOCKED_SESSION_STATUSES } from "@/services/modules/school-organization/school-organization-constant";
import { useInvalidateCurriculum } from "./use-invalidate-curriculum";

export interface CloneCurriculumDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: AcademicSessionSummary[];
  /** The session the screen shows: the default target. */
  currentSessionId: string;
  /** Called with the target's id when the clone landed in a session the screen isn't showing. */
  onSwitchSession: (sessionId: string) => void;
}

/**
 * Copies every curriculum mapping from one session into another. Rows the target already has
 * are skipped, so a repeat converges; the synchronous result is `{ created, skipped }`.
 *
 * Mounting contract: the caller mounts this only while it is open, so each open is a new
 * instance with its own idempotency keys. The server replays by key and ignores the body, so
 * there is one key per source-to-target pair: a retry of the same choice (after a lost
 * response) resends its key, a changed choice gets a new one, and a later open never replays
 * an earlier attempt.
 */
export function CloneCurriculumDialog({
  open,
  onOpenChange,
  sessions,
  currentSessionId,
  onSwitchSession,
}: CloneCurriculumDialogProps) {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const invalidateCurriculum = useInvalidateCurriculum();
  const idempotencyKeys = useRef(new Map<string, string>());

  const schema = useMemo(
    () => createCloneCurriculumFormSchema(tCommon("requiredField")),
    [tCommon],
  );
  const form = useForm<CloneCurriculumFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { source_academic_session_id: "", target_academic_session_id: currentSessionId },
  });
  const targetId = useWatch({ control: form.control, name: "target_academic_session_id" });

  // Into a session that is read-only the server refuses, so only writable ones are offered;
  // from any session but the target, a closed one included (last year's is the usual source).
  const targets = sessions.filter((session) => !LOCKED_SESSION_STATUSES.includes(session.status));
  const sources = sessions.filter((session) => session.id !== targetId);

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: CloneCurriculumFormValues) => {
      const source = values.source_academic_session_id;
      const target = values.target_academic_session_id;
      const pair = `${source}:${target}`;
      const key = idempotencyKeys.current.get(pair) ?? crypto.randomUUID();
      idempotencyKeys.current.set(pair, key);
      return Services.curriculum.cloneCurriculum(source, target, key);
    },
    // A refusal can name a session field, and this form shows its error as one message.
    knownFields: [],
    onSuccess: (result, values) => {
      invalidateCurriculum();
      toast.success(
        t("curriculum.clone.result", { created: result.created, skipped: result.skipped }),
      );
      if (values.target_academic_session_id !== currentSessionId) {
        onSwitchSession(values.target_academic_session_id);
      }
      onOpenChange(false);
    },
    fallbackMessage: t("common.submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("curriculum.clone.title")}
      description={t("curriculum.clone.description")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t("curriculum.clone.submitting")}
      submitLabel={t("curriculum.clone.confirm")}
    >
      <FormSelectField
        form={form}
        name="source_academic_session_id"
        label={t("curriculum.clone.sourceSession")}
        placeholder={t("fields.selectSession")}
        options={sources}
      />
      <FormSelectField
        form={form}
        name="target_academic_session_id"
        label={t("curriculum.clone.targetSession")}
        placeholder={t("fields.selectSession")}
        options={targets}
        // The source can't also be the target: clear it when the target moves onto it.
        onPick={(sessionId) => {
          if (form.getValues("source_academic_session_id") === sessionId) {
            form.setValue("source_academic_session_id", "");
          }
        }}
      />
    </FormDialogLayout>
  );
}
