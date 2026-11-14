"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
} from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { enumLabel } from "@/lib/enum-label";
import { Services } from "@/services";
import {
  SCHOLARSHIP_COVERAGES,
  SCHOLARSHIP_ERROR_FIELDS,
  SCHOLARSHIP_INITIAL_STATUSES,
  SCHOLARSHIP_NAME_MAX,
  SCHOLARSHIP_NOTES_MAX,
  SCHOLARSHIP_SPONSOR_MAX,
  SCHOLARSHIP_TYPES,
  SCHOLARSHIPS_QUERY_MODULE,
} from "@/services/modules/scholarships/scholarships-constant";
import {
  buildScholarshipInput,
  defaultScholarshipFormValues,
} from "@/services/modules/scholarships/scholarships-helper";
import {
  createScholarshipFormSchema,
  type ScholarshipFormValues,
} from "@/services/modules/scholarships/scholarships.schema";
import {
  GRANT_VALUE_TYPE_LABEL_KEY,
  SCHOLARSHIP_STATUS_LABEL_KEY,
  SCHOLARSHIP_TYPE_LABEL_KEY,
} from "@/features/fees/shared/grant-labels";
import { GrantStudentField } from "./grant-student-field";
import { useGrantReferences } from "./use-grant-references";

export interface ScholarshipFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Adds an award for one student and session, starting as applied or already approved. A server
 * refusal (a percent over 100) shows under its field; any other is the form's message.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form.
 */
export function ScholarshipFormDialog({ open, onOpenChange }: ScholarshipFormDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(SCHOLARSHIPS_QUERY_MODULE);
  const references = useGrantReferences();

  const schema = useMemo(
    () =>
      createScholarshipFormSchema({
        required: tCommon("requiredField"),
        invalidValue: t("grants.form.errors.invalidValue"),
      }),
    [t, tCommon],
  );
  const form = useForm<ScholarshipFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultScholarshipFormValues(),
  });
  const isPercent = form.watch("coverage_type") === "percent";

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: ScholarshipFormValues) =>
      Services.scholarships.createScholarship(buildScholarshipInput(values)),
    knownFields: SCHOLARSHIP_ERROR_FIELDS,
    onSuccess: () => {
      invalidate();
      toast.success(t("grants.scholarships.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("grants.scholarships.form.createTitle")}
      description={t("grants.scholarships.form.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <GrantStudentField form={form} name="student" />
      <FormSelectField
        form={form}
        name="academic_session"
        label={t("grants.form.session")}
        placeholder={t("grants.form.selectSession")}
        options={references.sessions}
      />
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("grants.scholarships.form.name")}</FormLabel>
            <FormControl>
              <Input maxLength={SCHOLARSHIP_NAME_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormSelectField
        form={form}
        name="scholarship_type"
        label={t("grants.scholarships.form.type")}
        placeholder={t("grants.scholarships.form.type")}
        options={SCHOLARSHIP_TYPES.map((type) => ({
          id: type,
          name: enumLabel(t, SCHOLARSHIP_TYPE_LABEL_KEY, type),
        }))}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormSelectField
          form={form}
          name="coverage_type"
          label={t("grants.scholarships.form.coverage")}
          placeholder={t("grants.scholarships.form.coverage")}
          options={SCHOLARSHIP_COVERAGES.map((coverage) => ({
            id: coverage,
            name: enumLabel(t, GRANT_VALUE_TYPE_LABEL_KEY, coverage),
          }))}
        />
        <FormField
          control={form.control}
          name="value"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("grants.form.value")}</FormLabel>
              <FormControl>
                <Input inputMode="decimal" {...field} />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                {t(isPercent ? "grants.form.percentHint" : "grants.form.fixedHint")}
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="sponsor"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("grants.scholarships.form.sponsor")}</FormLabel>
            <FormControl>
              <Input maxLength={SCHOLARSHIP_SPONSOR_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormSelectField
        form={form}
        name="status"
        label={t("grants.scholarships.form.status")}
        placeholder={t("grants.scholarships.form.status")}
        options={SCHOLARSHIP_INITIAL_STATUSES.map((status) => ({
          id: status,
          name: enumLabel(t, SCHOLARSHIP_STATUS_LABEL_KEY, status),
        }))}
      />
      <FormField
        control={form.control}
        name="notes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("grants.scholarships.form.notes")}</FormLabel>
            <FormControl>
              <Textarea rows={2} maxLength={SCHOLARSHIP_NOTES_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialogLayout>
  );
}
