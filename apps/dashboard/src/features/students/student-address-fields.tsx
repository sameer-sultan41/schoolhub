"use client";

import { useTranslations } from "next-intl";
import { FormControl, FormField, FormItem, FormLabel, Input } from "@schoolhub/ui";
import type { UseFormReturn } from "react-hook-form"; // a direct dependency (apps/dashboard/package.json) — not re-exported by @schoolhub/ui
import type { StudentFormValues } from "./student-form-schema";

export function StudentAddressFields({ form }: { form: UseFormReturn<StudentFormValues> }) {
  const t = useTranslations("students");
  const fields = [
    ["address_line1", "line1"],
    ["address_line2", "line2"],
    ["address_city", "city"],
    ["address_state", "state"],
    ["address_postal_code", "postalCode"],
    ["address_country", "country"],
  ] as const;
  return (
    <>
      {fields.map(([name, labelKey]) => (
        <FormField
          key={name}
          control={form.control}
          name={name}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t(`address.${labelKey}`)}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
            </FormItem>
          )}
        />
      ))}
    </>
  );
}
