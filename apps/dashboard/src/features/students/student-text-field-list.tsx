"use client";

import { useTranslations } from "next-intl";
import { FormControl, FormField, FormItem, FormLabel, FormMessage, Input } from "@schoolhub/ui";
import type { UseFormReturn } from "react-hook-form"; // a direct dependency (apps/dashboard/package.json) — not re-exported by @schoolhub/ui
import type { StudentFormValues } from "./student-form-schema";

/**
 * Renders one `FormField`/`Input`/`FormMessage` per `[fieldName, labelKey]` tuple — the
 * shape `StudentAddressFields`, `StudentProfileTextFields`, and the name fields in
 * `student-form-dialog.tsx` each implemented independently (three copies of the same
 * loop, differing only in which fields and which i18n namespace the labels come from).
 * `namespace` picks the `students.<namespace>.*` keys this caller's field list uses —
 * `"address"` for `address_line1` etc., `"fields"` for everything else.
 */
export function StudentTextFieldList({
  form,
  fields,
  namespace,
}: {
  form: UseFormReturn<StudentFormValues>;
  fields: ReadonlyArray<readonly [keyof StudentFormValues, string]>;
  namespace: "address" | "fields";
}) {
  const t = useTranslations("students");
  return (
    <>
      {fields.map(([name, labelKey]) => (
        <FormField
          key={name}
          control={form.control}
          name={name}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t(`${namespace}.${labelKey}`)}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ))}
    </>
  );
}
