"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError } from "@schoolhub/api-client";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ApiErrorAlert, unhandledEnvelopeError } from "@/features/academics/academics-error-alert";
import type { CloneCurriculumResult } from "@/features/academics/academics-types";
import {
  cloneCurriculumSchema,
  type CloneCurriculumFormValues,
} from "@/features/academics/curriculum-schema";
import { newIdempotencyKey } from "@/features/academics/idempotency-key";
import { useAcademicSessions } from "@/features/students/use-reference-data";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

const EMPTY_VALUES: CloneCurriculumFormValues = {
  source_academic_session_id: "",
  target_academic_session_id: "",
};

/**
 * §7.1's first step: seed a new session's curriculum from the previous one.
 *
 * The endpoint is idempotency-keyed server-side, so the key is minted once when
 * the dialog opens rather than per submit — a second click after a timeout has
 * to carry the first click's key to replay instead of cloning twice. The service
 * also skips rows the target already has, so a clone converges even when the key
 * is gone.
 */
export function CloneCurriculumDialog() {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [summary, setSummary] = useState<CloneCurriculumResult | null>(null);

  const sessions = useAcademicSessions();

  const form = useForm<CloneCurriculumFormValues>({
    resolver: zodResolver(cloneCurriculumSchema),
    defaultValues: EMPTY_VALUES,
  });
  const { handleSubmit, setError, reset } = form;

  const mutation = useMutation({
    mutationFn: async (values: CloneCurriculumFormValues) => {
      const result = await apiClient.post<CloneCurriculumResult>("/class-subjects:clone", values, {
        idempotencyKey,
      });
      return result.data;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("academics") });
      setSummary(result);
    },
    onError: (error: unknown) => {
      if (!(error instanceof ApiError)) return;
      const fieldErrors = error.fieldErrors();
      for (const field of ["source_academic_session_id", "target_academic_session_id"] as const) {
        const issue = fieldErrors[field];
        if (issue) setError(field, { type: "server", message: issue });
      }
      const unknown = Object.entries(fieldErrors)
        .filter(([field]) => !(field in EMPTY_VALUES))
        .map(([, issue]) => issue);
      if (unknown.length > 0) {
        setError("root", { type: "server", message: unknown.join(" ") });
      }
    },
  });

  const rootMessage = form.formState.errors.root?.message;
  const envelopeError = unhandledEnvelopeError(mutation.error);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          reset(EMPTY_VALUES);
          setSummary(null);
          // A closed-and-reopened dialog is a new intent, so it gets a new key.
          setIdempotencyKey(newIdempotencyKey());
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t("curriculum.actions.clone")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("curriculum.clone.title")}</DialogTitle>
          <DialogDescription>{t("curriculum.clone.description")}</DialogDescription>
        </DialogHeader>

        <ApiErrorAlert error={envelopeError} />
        {rootMessage ? (
          <p role="alert" className="text-sm text-danger">
            {rootMessage}
          </p>
        ) : null}
        {summary ? (
          <Alert variant="success">
            <AlertDescription>
              {t("curriculum.clone.result", {
                created: summary.created,
                skipped: summary.skipped,
              })}
            </AlertDescription>
          </Alert>
        ) : null}

        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              handleSubmit((values) => {
                mutation.mutate(values);
              })(event).catch((error: unknown) => {
                console.error("Unexpected error while cloning the curriculum:", error);
              });
            }}
            noValidate
          >
            <FormField
              control={form.control}
              name="source_academic_session_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("curriculum.clone.sourceSession")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl required>
                      <SelectTrigger aria-label={t("curriculum.clone.sourceSession")}>
                        <SelectValue placeholder={t("fields.selectSession")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(sessions.data ?? []).map((session) => (
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
            <FormField
              control={form.control}
              name="target_academic_session_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("curriculum.clone.targetSession")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl required>
                      <SelectTrigger aria-label={t("curriculum.clone.targetSession")}>
                        <SelectValue placeholder={t("fields.selectSession")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(sessions.data ?? []).map((session) => (
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

            <DialogFooter>
              <Button
                type="submit"
                isLoading={mutation.isPending}
                loadingLabel={tCommon("loading")}
              >
                {t("curriculum.actions.clone")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
