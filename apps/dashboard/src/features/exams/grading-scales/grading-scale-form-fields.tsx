"use client";

import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@schoolhub/ui";

import { FormSelectField } from "@/components/form-select-field";
import {
  GPA_SCALE_TYPES,
  SCALE_DESCRIPTION_MAX,
  SCALE_NAME_MAX,
  SCALE_TYPES,
} from "@/services/modules/grading-scales/grading-scales-constant";
import type { ScaleFormValues } from "@/services/modules/grading-scales/grading-scales.schema";

/** The scale form's inputs. Every field renders its own `FormMessage`, so a server error the
 * dialog maps onto it is shown under it. The maximum grade point shows only for a type that
 * needs one. */
export function GradingScaleFormFields({ form }: { form: UseFormReturn<ScaleFormValues> }) {
  const t = useTranslations("exams");
  const typeOptions = SCALE_TYPES.map((scaleType) => ({
    id: scaleType,
    name: t(`gradingScales.types.${scaleType}`),
  }));
  const needsGpaMax = GPA_SCALE_TYPES.includes(form.watch("scale_type"));

  return (
    <>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("gradingScales.form.name")}</FormLabel>
            <FormControl>
              <Input maxLength={SCALE_NAME_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormSelectField
        form={form}
        name="scale_type"
        label={t("gradingScales.form.type")}
        placeholder={t("gradingScales.form.type")}
        options={typeOptions}
      />
      {needsGpaMax && (
        <FormField
          control={form.control}
          name="gpa_max"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("gradingScales.form.gpaMax")}</FormLabel>
              <FormControl>
                <Input inputMode="decimal" {...field} />
              </FormControl>
              <FormDescription>{t("gradingScales.form.gpaMaxHint")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("gradingScales.form.description")}</FormLabel>
            <FormControl>
              <Input maxLength={SCALE_DESCRIPTION_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
