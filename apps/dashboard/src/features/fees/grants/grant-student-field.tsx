"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { FormField, FormItem, FormLabel, FormMessage } from "@schoolhub/ui";

import {
  StudentPicker,
  type PickedStudent,
} from "@/features/communication/messages/student-picker";

export interface GrantStudentFieldProps<TFieldValues extends FieldValues> {
  form: UseFormReturn<TFieldValues>;
  /** The string field that holds the picked student's id. */
  name: Path<TFieldValues>;
}

/**
 * The student a grant or fine is for: the messaging module's searchable `StudentPicker`, stored
 * as the id the API wants. The picked name is kept here only to show on the chip. The picker is
 * the one cross-feature import; the fee counter (PR C) is its second owner and hoists it.
 */
export function GrantStudentField<TFieldValues extends FieldValues>({
  form,
  name,
}: GrantStudentFieldProps<TFieldValues>) {
  const t = useTranslations("fees.grants.form");
  const [picked, setPicked] = useState<PickedStudent | null>(null);

  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t("student")}</FormLabel>
          <StudentPicker
            value={picked}
            onChange={(student) => {
              setPicked(student);
              field.onChange(student?.id ?? "");
            }}
          />
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
