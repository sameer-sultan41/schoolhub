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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { PROMOTION_DECISIONS } from "@/features/academics/academics-constants";
import { ApiErrorAlert, unhandledEnvelopeError } from "@/features/academics/academics-error-alert";
import type { PromotionDecisionRecord } from "@/features/academics/academics-types";
import { mapPromotionDecisionFieldErrors } from "@/features/academics/promotion-map-field-errors";
import {
  promotionDecisionSchema,
  type PromotionDecisionFormValues,
} from "@/features/academics/promotion-schema";
import { useClasses, useSectionsForClass } from "@/features/students/use-reference-data";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

interface PromotionDecisionFormProps {
  decision: PromotionDecisionRecord;
  studentLabel: string;
}

function defaultValues(record: PromotionDecisionRecord): PromotionDecisionFormValues {
  return {
    decision: record.decision,
    to_class_id: record.to_class_id ?? "",
    to_section_id: record.to_section_id ?? "",
    override_reason: record.override_reason ?? "",
    remarks: record.remarks ?? "",
  };
}

/**
 * Adjust one student's draft decision (§7.2's review step).
 *
 * `PATCH /student-promotions/{batch_id}/decisions/{student_id}` — addressed by the
 * student a reviewer actually has in hand rather than an opaque row id, which is
 * also §16's shape. The viewset refuses anything that has left `draft` with a 409,
 * so this dialog is only rendered for draft rows.
 *
 * The target section matters at execution: `services._execute_one` refuses a
 * non-graduating row with no `to_section_id`, so filling it in here is what makes
 * the batch executable later.
 */
export function PromotionDecisionForm({ decision, studentLabel }: PromotionDecisionFormProps) {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const classes = useClasses();

  const form = useForm<PromotionDecisionFormValues>({
    resolver: zodResolver(promotionDecisionSchema),
    defaultValues: defaultValues(decision),
  });
  const { handleSubmit, setError, reset, control } = form;

  // useWatch, not form.watch(): the latter returns a fresh function each
  // render, which React Compiler refuses to memoize (it would risk stale UI).
  const selectedDecision = useWatch({ control, name: "decision" });
  const selectedClassId = useWatch({ control, name: "to_class_id" });
  const sections = useSectionsForClass(selectedClassId || undefined);
  const isGraduating = selectedDecision === "graduated";

  const mutation = useMutation({
    mutationFn: async (values: PromotionDecisionFormValues) => {
      // Empty string → null in the mutation, not the schema: `to_class_id` must be
      // literally null for a graduating student or the database's
      // promotions_target_class_matches_decision constraint rejects the row.
      const payload = {
        decision: values.decision,
        to_class_id: values.to_class_id || null,
        to_section_id: values.to_section_id || null,
        override_reason: values.override_reason || null,
        remarks: values.remarks || null,
      };
      const result = await apiClient.patch<PromotionDecisionRecord>(
        `/student-promotions/${decision.batch_id}/decisions/${decision.student_id}`,
        payload,
      );
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("academics") });
      setOpen(false);
    },
    onError: (error: unknown) => {
      if (!(error instanceof ApiError)) return;
      const { known, unknown } = mapPromotionDecisionFieldErrors(error.fieldErrors());
      for (const [field, issue] of Object.entries(known)) {
        setError(field as keyof PromotionDecisionFormValues, { type: "server", message: issue });
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
        // Both edges, not just the close. `onSuccess` invalidates the whole
        // academics module, so editing any other row in the batch re-fetches this
        // one while this dialog is shut — and a form that only reset on close
        // would then reopen showing the values it was mounted with and write
        // them back over the fresh ones.
        reset(defaultValues(decision));
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t("promotions.actions.editDecision")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("promotions.decision.title")}</DialogTitle>
          <DialogDescription>
            {t("promotions.decision.description", { student: studentLabel })}
          </DialogDescription>
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
                console.error("Unexpected error while saving the promotion decision:", error);
              });
            }}
            noValidate
          >
            <FormField
              control={form.control}
              name="decision"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("promotions.columns.decision")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl required>
                      <SelectTrigger aria-label={t("promotions.columns.decision")}>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PROMOTION_DECISIONS.map((value) => (
                        <SelectItem key={value} value={value}>
                          {t(`promotions.decisionValue.${value}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="to_class_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("promotions.fields.toClass")}</FormLabel>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                      disabled={isGraduating}
                    >
                      <FormControl>
                        <SelectTrigger aria-label={t("promotions.fields.toClass")}>
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
              <FormField
                control={form.control}
                name="to_section_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("promotions.fields.toSection")}</FormLabel>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                      disabled={isGraduating || !selectedClassId}
                    >
                      <FormControl>
                        <SelectTrigger aria-label={t("promotions.fields.toSection")}>
                          <SelectValue placeholder={t("fields.selectSection")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(sections.data ?? []).map((section) => (
                          <SelectItem key={section.id} value={section.id}>
                            {section.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>{t("promotions.fields.toSectionHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="override_reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("promotions.fields.overrideReason")}</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormDescription>{t("promotions.fields.overrideReasonHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="remarks"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("promotions.fields.remarks")}</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
                  </FormControl>
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
                {tCommon("save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
