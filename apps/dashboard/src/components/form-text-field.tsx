"use client";

import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@schoolhub/ui";

export interface FormTextFieldProps<TFieldValues extends FieldValues> {
  form: UseFormReturn<TFieldValues>;
  /** A string field. */
  name: Path<TFieldValues>;
  label: string;
  maxLength?: number;
  description?: string;
  type?: "text" | "email" | "tel" | "date";
  placeholder?: string;
}

/** A labelled text input with its own `FormMessage`, so a server error mapped onto it shows
 * under it. */
export function FormTextField<TFieldValues extends FieldValues>({
  form,
  name,
  label,
  maxLength,
  description,
  type = "text",
  placeholder,
}: FormTextFieldProps<TFieldValues>) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type={type} maxLength={maxLength} placeholder={placeholder} {...field} />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
