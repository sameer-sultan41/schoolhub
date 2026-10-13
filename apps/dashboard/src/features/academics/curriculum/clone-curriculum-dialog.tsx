"use client";

import { useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm, useWatch, type UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import {
  Alert,
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";

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
import { foldUnknownFieldErrors, NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services, type AcademicSessionSummary } from "@/services";
import {
  createCloneCurriculumFormSchema,
  type CloneCurriculumFormValues,
} from "@/services/modules/curriculum/curriculum.schema";
import { LOCKED_SESSION_STATUSES } from "@/services/modules/school-organization/school-organization-constant";

type SessionFieldName = "source_academic_session_id" | "target_academic_session_id";

interface SessionFieldProps {
  form: UseFormReturn<CloneCurriculumFormValues>;
  name: SessionFieldName;
  label: string;
  options: readonly AcademicSessionSummary[];
  /** Runs after the pick is stored, for a change the other field must follow. */
  onPick?: (sessionId: string) => void;
}

function SessionField({ form, name, label, options, onPick }: SessionFieldProps) {
  const t = useTranslations("academics");

  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select
            value={field.value}
            onValueChange={(sessionId) => {
              field.onChange(sessionId);
              onPick?.(sessionId);
            }}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder={t("fields.selectSession")} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((session) => (
                <SelectItem key={session.id} value={session.id}>
                  {session.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

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
  const tErrors = useTranslations("errors");
  const isMobile = !useIsDesktopShell();
  const queryClient = useQueryClient();
  const submitGuard = useSubmitGuard();
  const [formError, setFormError] = useState<string | null>(null);
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

  const mutation = useMutation({
    mutationFn: (values: CloneCurriculumFormValues) => {
      const source = values.source_academic_session_id;
      const target = values.target_academic_session_id;
      const pair = `${source}:${target}`;
      const key = idempotencyKeys.current.get(pair) ?? crypto.randomUUID();
      idempotencyKeys.current.set(pair, key);
      return Services.curriculum.cloneCurriculum(source, target, key);
    },
    onSuccess: (result, values) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("curriculum") });
      toast.success(
        t("curriculum.clone.result", { created: result.created, skipped: result.skipped }),
      );
      if (values.target_academic_session_id !== currentSessionId) {
        onSwitchSession(values.target_academic_session_id);
      }
      onOpenChange(false);
    },
    onError: (error) => {
      // A refusal can name a session field, and this form shows its error as one message.
      setFormError(
        resolveErrorMessage(
          foldUnknownFieldErrors(error),
          tErrors,
          t("common.submitFailed"),
          NON_FIELD,
        ),
      );
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
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("curriculum.clone.title")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <Form {...form}>
          <form
            noValidate
            onSubmit={handleSubmit}
            className={isMobile ? "flex min-h-0 grow flex-col" : undefined}
          >
            <ResponsiveDialogBody
              className={
                isMobile
                  ? "space-y-4 overflow-y-auto"
                  : "max-h-[65vh] space-y-4 overflow-y-auto pe-1"
              }
            >
              <p className="text-sm text-muted-foreground">{t("curriculum.clone.description")}</p>
              {formError && <Alert variant="destructive">{formError}</Alert>}
              <SessionField
                form={form}
                name="source_academic_session_id"
                label={t("curriculum.clone.sourceSession")}
                options={sources}
              />
              <SessionField
                form={form}
                name="target_academic_session_id"
                label={t("curriculum.clone.targetSession")}
                options={targets}
                // The source can't also be the target: clear it when the target moves onto it.
                onPick={(sessionId) => {
                  if (form.getValues("source_academic_session_id") === sessionId) {
                    form.setValue("source_academic_session_id", "");
                  }
                }}
              />
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
                loadingLabel={t("curriculum.clone.submitting")}
              >
                {t("curriculum.clone.confirm")}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </Form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
