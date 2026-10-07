"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import {
  Alert,
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
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
import { applyServerFieldErrors } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  changeSectionFormSchema,
  type ChangeSectionFormValues,
} from "@/services/modules/students/students.schema";
import { ClassSectionFields } from "./class-section-fields";

export interface ChangeSectionDialogProps {
  studentId: string;
  campusId: string;
  currentClass: { id: string; name: string };
  /** Gates `students.student.update`, the capacity-override field — distinct from the
   * action's own permission, `students.enrollment.update`. */
  canOverrideCapacity: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangeSectionDialog({
  studentId,
  campusId,
  currentClass,
  canOverrideCapacity,
  open,
  onOpenChange,
}: ChangeSectionDialogProps) {
  const tCommon = useTranslations("common");
  const t = useTranslations("students");
  const isMobile = !useIsDesktopShell();

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} nested>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("enrollment.changeSection")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {open ? (
          <ChangeSectionBody
            studentId={studentId}
            campusId={campusId}
            currentClass={currentClass}
            canOverrideCapacity={canOverrideCapacity}
            isMobile={isMobile}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

interface ChangeSectionBodyProps {
  studentId: string;
  campusId: string;
  currentClass: { id: string; name: string };
  canOverrideCapacity: boolean;
  isMobile: boolean;
  onOpenChange: (open: boolean) => void;
}

function ChangeSectionBody({
  studentId,
  campusId,
  currentClass,
  canOverrideCapacity,
  isMobile,
  onOpenChange,
}: ChangeSectionBodyProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const submitGuard = useSubmitGuard();
  const [formError, setFormError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const form = useForm<ChangeSectionFormValues>({
    resolver: zodResolver(changeSectionFormSchema),
    defaultValues: { section_id: "", roll_number: "", capacity_override_reason: "" },
  });

  const mutation = useMutation({
    mutationFn: (values: ChangeSectionFormValues) =>
      Services.students.changeStudentSection(
        studentId,
        {
          sectionId: values.section_id,
          ...(values.roll_number ? { rollNumber: values.roll_number } : {}),
          ...(values.capacity_override_reason
            ? { capacityOverrideReason: values.capacity_override_reason }
            : {}),
        },
        idempotencyKey,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("students") });
      onOpenChange(false);
    },
    onError: (error) => {
      applyServerFieldErrors({
        error,
        form,
        knownFields: Object.keys(changeSectionFormSchema.shape),
        tErrors,
        fallback: t("form.submitFailed"),
        setFormError,
      });
    },
  });

  const handleSubmit = useGuardedSubmit(
    form,
    submitGuard,
    (values) =>
      new Promise<void>((resolve) => {
        mutation.mutate(values, {
          onSettled: () => {
            resolve();
          },
        });
      }),
  );

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
          {formError && <Alert variant="destructive">{formError}</Alert>}
          <ClassSectionFields
            form={form}
            campusId={campusId}
            locked
            currentClass={currentClass}
            sectionFieldName="section_id"
          />
          <FormField
            control={form.control}
            name="roll_number"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("enrollment.fields.rollNumber")}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {canOverrideCapacity && (
            <FormField
              control={form.control}
              name="capacity_override_reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("enrollment.fields.overrideReason")}</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    {t("enrollment.fields.overrideReasonHint")}
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
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
          <Button type="submit" isLoading={mutation.isPending} loadingLabel={t("form.submitting")}>
            {t("enrollment.changeSection")}
          </Button>
        </ResponsiveDialogFooter>
      </form>
    </Form>
  );
}
