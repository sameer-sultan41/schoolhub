"use client";

import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { useTranslations } from "next-intl";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Textarea,
} from "@schoolhub/ui";

/** The server's cap on a lifecycle reason (`apps/api/apps/platform_admin/tenants/serializers.py`). */
export const REASON_MAX_LENGTH = 500;

/** A lifecycle action's reason, kept in the audit log: a textarea with its own `FormMessage`. */
export function ReasonField<TValues extends FieldValues>({
  form,
  name,
  description,
  optional = false,
  maxLength = REASON_MAX_LENGTH,
}: {
  form: UseFormReturn<TValues>;
  name: Path<TValues>;
  description?: string;
  /** `:reinstate` takes a reason without requiring one. */
  optional?: boolean;
  /** The server's cap for this action's reason, when it is not a lifecycle one. */
  maxLength?: number;
}) {
  const t = useTranslations("platform");
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel required={!optional}>{t("lifecycle.reason")}</FormLabel>
          <FormControl required={!optional}>
            <Textarea rows={3} maxLength={maxLength} {...field} />
          </FormControl>
          <FormDescription>{description ?? t("lifecycle.reasonHint")}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
