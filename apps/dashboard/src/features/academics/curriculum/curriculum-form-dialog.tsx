"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Alert, Button, Form } from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { useIsDesktopShell } from "@/hooks/use-is-desktop-shell";
import { useGuardedSubmit, useSubmitGuard } from "@/hooks/use-submit-guard";
import { applyServerFieldErrors, foldUnknownFieldErrors } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
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
  const isMobile = !useIsDesktopShell();

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {record ? t("curriculum.form.editTitle") : t("curriculum.form.createTitle")}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <CurriculumFormBody
          record={record}
          sessions={sessions}
          sessionId={sessionId}
          isMobile={isMobile}
          onOpenChange={onOpenChange}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

interface CurriculumFormBodyProps {
  record?: CurriculumRecord;
  sessions: AcademicSessionSummary[];
  sessionId: string;
  isMobile: boolean;
  onOpenChange: (open: boolean) => void;
}

function CurriculumFormBody({
  record,
  sessions,
  sessionId,
  isMobile,
  onOpenChange,
}: CurriculumFormBodyProps) {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const submitGuard = useSubmitGuard();
  const [formError, setFormError] = useState<string | null>(null);

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

  const mutation = useMutation({
    mutationFn: (values: CurriculumFormValues) =>
      record
        ? Services.curriculum.updateCurriculum(record.id, buildCurriculumInput(values, "edit"))
        : Services.curriculum.createCurriculum(buildCurriculumInput(values, "create")),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("curriculum") });
      toast.success(t("curriculum.saved"));
      onOpenChange(false);
    },
    onError: (error) => {
      // Read at error time: the group input is gone once the switch is off.
      const knownFields = curriculumErrorFields(
        record ? "edit" : "create",
        form.getValues("is_elective"),
      );
      applyServerFieldErrors({
        error: foldUnknownFieldErrors(error, knownFields),
        form,
        knownFields,
        tErrors,
        fallback: t("common.submitFailed"),
        setFormError,
      });
    },
  });

  const handleSubmit = useGuardedSubmit(form, submitGuard, (values) => {
    setFormError(null);
    return new Promise<void>((resolve) => {
      mutation.mutate(values, {
        onSettled: () => {
          resolve();
        },
      });
    });
  });

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={handleSubmit}
        className={isMobile ? "flex min-h-0 grow flex-col" : undefined}
      >
        <ResponsiveDialogBody
          className={
            isMobile ? "space-y-4 overflow-y-auto" : "max-h-[65vh] space-y-4 overflow-y-auto pe-1"
          }
        >
          <p className="text-sm text-muted-foreground">{t("curriculum.form.description")}</p>
          {formError && <Alert variant="destructive">{formError}</Alert>}
          <CurriculumFormFields form={form} record={record} sessions={sessions} />
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="submit"
            isLoading={mutation.isPending}
            loadingLabel={t("curriculum.form.submitting")}
          >
            {tCommon("save")}
          </Button>
        </ResponsiveDialogFooter>
      </form>
    </Form>
  );
}
