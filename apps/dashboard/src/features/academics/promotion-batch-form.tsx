"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError } from "@schoolhub/api-client";
import {
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
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ApiErrorAlert, unhandledEnvelopeError } from "@/components/api-error-alert";
import type { CreatePromotionBatchResult } from "@/features/academics/academics-types";
import { mapPromotionBatchFieldErrors } from "@/features/academics/promotion-map-field-errors";
import {
  promotionBatchSchema,
  type PromotionBatchFormValues,
} from "@/features/academics/promotion-schema";
import { useAcademicSessions, useClasses } from "@/features/students/use-reference-data";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

const EMPTY_VALUES: PromotionBatchFormValues = {
  from_academic_session_id: "",
  to_academic_session_id: "",
  class_id: "",
};

/**
 * §7.2's first step: one batch per class per rollover. The server proposes a
 * decision for every actively enrolled student in the class, so this form takes
 * only the two sessions and the class — there is nothing per-student to fill in
 * until the review table.
 *
 * On success it navigates straight to that review table: the returned `batch_id`
 * is the only handle on the batch (there is no batch table — `batch_id` is a
 * logical grouping over `student_promotions` rows), so dropping it here would
 * mean hunting for it in the list.
 */
export function PromotionBatchForm() {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const sessions = useAcademicSessions();
  const classes = useClasses();

  const form = useForm<PromotionBatchFormValues>({
    resolver: zodResolver(promotionBatchSchema),
    defaultValues: EMPTY_VALUES,
  });
  const { handleSubmit, setError, reset } = form;

  const mutation = useMutation({
    mutationFn: async (values: PromotionBatchFormValues) => {
      const result = await apiClient.post<CreatePromotionBatchResult>(
        "/student-promotions",
        values,
      );
      return result.data;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("academics") });
      setOpen(false);
      reset(EMPTY_VALUES);
      router.push(`/academics/promotions/${result.batch_id}`);
    },
    onError: (error: unknown) => {
      if (!(error instanceof ApiError)) return;
      const { known, unknown } = mapPromotionBatchFieldErrors(error.fieldErrors());
      for (const [field, issue] of Object.entries(known)) {
        setError(field as keyof PromotionBatchFormValues, { type: "server", message: issue });
      }
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
        if (!next) reset(EMPTY_VALUES);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">{t("promotions.actions.create")}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("promotions.form.createTitle")}</DialogTitle>
          <DialogDescription>{t("promotions.form.description")}</DialogDescription>
        </DialogHeader>

        <ApiErrorAlert error={envelopeError} />
        {rootMessage ? (
          <p role="alert" className="text-sm text-danger">
            {rootMessage}
          </p>
        ) : null}

        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              handleSubmit((values) => {
                mutation.mutate(values);
              })(event).catch((error: unknown) => {
                console.error("Unexpected error while creating the promotion batch:", error);
              });
            }}
            noValidate
          >
            <FormField
              control={form.control}
              name="from_academic_session_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("promotions.fields.fromSession")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl required>
                      <SelectTrigger aria-label={t("promotions.fields.fromSession")}>
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
              name="to_academic_session_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("promotions.fields.toSession")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl required>
                      <SelectTrigger aria-label={t("promotions.fields.toSession")}>
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
              name="class_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("fields.class")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl required>
                      <SelectTrigger aria-label={t("fields.class")}>
                        <SelectValue placeholder={t("fields.selectClass")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(classes.data ?? []).map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name}
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
                {t("promotions.actions.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
