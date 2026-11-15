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
  Switch,
} from "@schoolhub/ui";

export interface TextFormFieldProps<TValues extends FieldValues> {
  form: UseFormReturn<TValues>;
  name: Path<TValues>;
  label: string;
  maxLength?: number;
  description?: string;
  type?: "text" | "email" | "tel" | "date";
  placeholder?: string;
}

/** One labelled text input with its own `FormMessage`, so a server error the dialog maps onto
 * it shows under it. */
export function TextFormField<TValues extends FieldValues>({
  form,
  name,
  label,
  maxLength,
  description,
  type = "text",
  placeholder,
}: TextFormFieldProps<TValues>) {
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

/** One labelled on/off switch with its hint and its own `FormMessage`. */
export function SwitchFormField<TValues extends FieldValues>({
  form,
  name,
  label,
  description,
}: Pick<TextFormFieldProps<TValues>, "form" | "name" | "label" | "description">) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <div className="flex items-center justify-between gap-3">
            <FormLabel>{label}</FormLabel>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
          </div>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
