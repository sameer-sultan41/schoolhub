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
  type?: "text" | "email" | "tel" | "date" | "datetime-local";
  placeholder?: string;
  disabled?: boolean;
  /** The on-screen keyboard, e.g. `numeric` for a whole number kept as text (blank allowed). */
  inputMode?: "text" | "numeric" | "decimal" | "email" | "tel";
  autoComplete?: string;
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
  disabled,
  inputMode,
  autoComplete,
}: FormTextFieldProps<TFieldValues>) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            {/* `field` first: its own `disabled` (undefined unless the form sets one) must not
                override the prop. */}
            <Input
              {...field}
              type={type}
              maxLength={maxLength}
              placeholder={placeholder}
              disabled={disabled ?? field.disabled}
              inputMode={inputMode}
              autoComplete={autoComplete}
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
