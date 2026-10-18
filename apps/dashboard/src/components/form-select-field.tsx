"use client";

import { useTranslations } from "next-intl";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";

export interface FormSelectFieldProps<TFieldValues extends FieldValues> {
  form: UseFormReturn<TFieldValues>;
  /** A string field: it stores the picked option's `id`, or `""` for none. */
  name: Path<TFieldValues>;
  label: string;
  placeholder: string;
  options: readonly { id: string; name: string }[];
  disabled?: boolean;
  /**
   * An extra first option standing for the empty value (`""`), as a `SelectItem` can't carry
   * `""` itself: the item's `value` is what the select holds, and it is stored as `""`.
   */
  emptyOption?: { value: string; label: string };
  /** Runs after the pick is stored, for a change another field must follow. */
  onPick?: (value: string) => void;
  /** A hint under the select, above any error. */
  description?: string;
}

/** A form `Select` with its label and error message, over a list of `{ id, name }` options. */
export function FormSelectField<TFieldValues extends FieldValues>({
  form,
  name,
  label,
  placeholder,
  options,
  disabled,
  emptyOption,
  onPick,
  description,
}: FormSelectFieldProps<TFieldValues>) {
  const tCommon = useTranslations("common");

  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select
            value={field.value === "" && emptyOption ? emptyOption.value : field.value}
            onValueChange={(selected) => {
              const value = selected === emptyOption?.value ? "" : selected;
              field.onChange(value);
              onPick?.(value);
            }}
            disabled={disabled}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent emptyMessage={tCommon("noOptions")}>
              {emptyOption && (
                <SelectItem value={emptyOption.value}>{emptyOption.label}</SelectItem>
              )}
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
