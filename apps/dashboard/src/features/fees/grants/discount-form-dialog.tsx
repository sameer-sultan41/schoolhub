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
  DISCOUNT_ERROR_FIELDS,
  DISCOUNT_NAME_MAX,
  DISCOUNT_REASON_MAX,
  DISCOUNT_TYPES,
  DISCOUNTS_QUERY_MODULE,
} from "@/services/modules/discounts/discounts-constant";
import {
  buildDiscountInput,
  defaultDiscountFormValues,
} from "@/services/modules/discounts/discounts-helper";
import {
  createDiscountFormSchema,
  type DiscountFormValues,
} from "@/services/modules/discounts/discounts.schema";
import { GRANT_VALUE_TYPE_LABEL_KEY } from "@/features/fees/shared/grant-labels";
import { GrantStudentField } from "./grant-student-field";
import { useGrantReferences } from "./use-grant-references";

export interface DiscountFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Grants a discount to one student for a session, to every fee head or one. A server refusal
 * (a percent over 100, an end before the start) shows under its field; any other is the form's
 * message. The head picker is optional, so a writer without `fees.fee-structure.view` still
 * grants an every-head discount.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form.
 */
export function DiscountFormDialog({ open, onOpenChange }: DiscountFormDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(DISCOUNTS_QUERY_MODULE);
  const references = useGrantReferences();

  const schema = useMemo(
    () =>
      createDiscountFormSchema({
        required: tCommon("requiredField"),
        invalidValue: t("grants.form.errors.invalidValue"),
        endBeforeStart: t("grants.form.errors.endBeforeStart"),
      }),
    [t, tCommon],
  );
  const form = useForm<DiscountFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultDiscountFormValues(),
  });
  const isPercent = form.watch("discount_type") === "percent";

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: DiscountFormValues) =>
      Services.discounts.createDiscount(buildDiscountInput(values)),
    knownFields: DISCOUNT_ERROR_FIELDS,
    onSuccess: () => {
      invalidate();
      toast.success(t("grants.discounts.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("grants.discounts.form.createTitle")}
      description={t("grants.discounts.form.intro")}
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
            <FormLabel>{t("grants.discounts.form.name")}</FormLabel>
            <FormControl>
              <Input maxLength={DISCOUNT_NAME_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormSelectField
          form={form}
          name="discount_type"
          label={t("grants.discounts.form.type")}
          placeholder={t("grants.discounts.form.type")}
          options={DISCOUNT_TYPES.map((type) => ({
            id: type,
            name: enumLabel(t, GRANT_VALUE_TYPE_LABEL_KEY, type),
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
      {references.canReadHeads && (
        <FormSelectField
          form={form}
          name="fee_head"
          label={t("grants.form.head")}
          placeholder={t("grants.form.selectHead")}
          options={references.heads.map((head) => ({ id: head.id, name: head.name }))}
          emptyOption={{ value: "all-heads", label: t("grants.form.allHeads") }}
        />
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="valid_from"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("grants.discounts.form.validFrom")}</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="valid_to"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("grants.discounts.form.validTo")}</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="reason"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("grants.discounts.form.reason")}</FormLabel>
            <FormControl>
              <Textarea rows={2} maxLength={DISCOUNT_REASON_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialogLayout>
  );
}
