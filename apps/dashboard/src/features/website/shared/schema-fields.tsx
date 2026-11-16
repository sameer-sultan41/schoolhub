"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@schoolhub/ui";

import { humanizeSnakeCase } from "@/lib/helpers";
import type { JsonSchema } from "@/services";
import { ImageFileField } from "./image-file-field";
import { RichTextBlocksField } from "./rich-text-blocks-field";
import { SchemaObjectArrayField, SchemaStringArrayField } from "./schema-array-fields";
import { fieldKind, joinPath, textValue, toSchemaFormValues } from "./schema-model";
import type { SchemaMessages } from "./schema-zod";

/** The validation messages `schemaToZod` takes, in the viewer's language. */
export function useSchemaMessages(): SchemaMessages {
  const t = useTranslations("website.schemaFields.errors");
  const tCommon = useTranslations("common");
  return useMemo<SchemaMessages>(
    () => ({
      required: tCommon("requiredField"),
      tooLong: (max) => t("tooLong", { max }),
      tooShort: (min) => t("tooShort", { min }),
      notANumber: t("notANumber"),
      notAWholeNumber: t("notAWholeNumber"),
      tooSmall: (min) => t("tooSmall", { min }),
      tooLarge: (max) => t("tooLarge", { max }),
      unsafeUrl: t("unsafeUrl"),
      notAnOption: t("notAnOption"),
      imageRequired: t("imageRequired"),
    }),
    [t, tCommon],
  );
}

export interface SchemaFieldsProps<TFieldValues extends FieldValues> {
  form: UseFormReturn<TFieldValues>;
  /** A theme section's content schema, or a theme's `config_schema` (decision 6). */
  schema: JsonSchema;
  /** Where the values sit in the form (`content`); empty for the form's root. */
  name?: string;
}

/**
 * Every input of one JSON Schema object, from the constrained subset of decision 6, so a new
 * theme or section type needs no dashboard code (decision 12). The host builds its resolver
 * with `schemaToZod(schema, useSchemaMessages())`, its defaults with `toSchemaFormValues`,
 * the payload with `fromSchemaFormValues`, and maps a 422 with `rekeySchemaErrors`. Each input
 * renders its own `FormMessage`; a keyword outside the subset is ignored.
 */
export function SchemaFields<TFieldValues extends FieldValues>({
  form,
  schema,
  name = "",
}: SchemaFieldsProps<TFieldValues>) {
  const required = new Set(schema.required ?? []);
  return (
    <div className="space-y-4">
      {Object.entries(schema.properties ?? {}).map(([key, prop]) => (
        <SchemaField
          key={key}
          form={form}
          name={joinPath(name, key)}
          propName={key}
          schema={prop}
          required={required.has(key)}
        />
      ))}
    </div>
  );
}

function inputModeOf(kind: string, schema: JsonSchema): "url" | "numeric" | "decimal" | undefined {
  if (kind === "url") return "url";
  if (kind !== "number") return undefined;
  return schema.type === "integer" ? "numeric" : "decimal";
}

interface SchemaFieldProps<TFieldValues extends FieldValues> {
  form: UseFormReturn<TFieldValues>;
  name: string;
  propName: string;
  schema: JsonSchema;
  required: boolean;
}

function SchemaField<TFieldValues extends FieldValues>({
  form,
  name,
  propName,
  schema,
  required,
}: SchemaFieldProps<TFieldValues>) {
  const t = useTranslations("website.schemaFields");
  const label =
    schema.title ??
    (t.has(`labels.${propName}`) ? t(`labels.${propName}`) : humanizeSnakeCase(propName));
  const path = name as Path<TFieldValues>;
  const kind = fieldKind(schema);

  switch (kind) {
    case "rich-text":
      return <RichTextBlocksField form={form} name={path} label={label} />;
    case "image":
      return <ImageFileField form={form} name={path} label={label} required={required} />;
    case "object":
      return (
        <fieldset className="space-y-4 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">{label}</legend>
          <SchemaFields form={form} schema={schema} name={name} />
        </fieldset>
      );
    case "object-array": {
      const itemSchema = schema.items ?? {};
      return (
        <SchemaObjectArrayField
          form={form}
          name={name}
          label={label}
          newItem={() => toSchemaFormValues(itemSchema, {})}
          renderItem={(itemName) => (
            <SchemaFields form={form} schema={itemSchema} name={itemName} />
          )}
        />
      );
    }
    case "string-array":
      return <SchemaStringArrayField form={form} name={name} label={label} />;
    default:
      return (
        <FormField
          control={form.control}
          name={path}
          render={({ field }) => (
            <FormItem>
              {kind === "boolean" ? (
                <div className="flex items-center justify-between gap-3">
                  <FormLabel>{label}</FormLabel>
                  <FormControl>
                    <Switch checked={field.value === true} onCheckedChange={field.onChange} />
                  </FormControl>
                </div>
              ) : (
                <FormLabel>{label}</FormLabel>
              )}
              {kind === "select" ? (
                <Select value={textValue(field.value)} onValueChange={field.onChange}>
                  <FormControl required={required}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("selectPlaceholder")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {(schema.enum ?? []).map((option) => {
                      const value = String(option);
                      return (
                        <SelectItem key={value} value={value}>
                          {t.has(`options.${value}`)
                            ? t(`options.${value}`)
                            : humanizeSnakeCase(value)}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              ) : null}
              {kind === "textarea" ? (
                <FormControl required={required}>
                  <Textarea
                    {...field}
                    value={textValue(field.value)}
                    maxLength={schema.maxLength}
                    rows={4}
                  />
                </FormControl>
              ) : null}
              {kind === "text" || kind === "url" || kind === "number" ? (
                <FormControl required={required}>
                  <Input
                    {...field}
                    value={textValue(field.value)}
                    // A text input even for a link: a `/`-relative path is a valid `safe-url`
                    // that the browser's own `type="url"` check would refuse.
                    inputMode={inputModeOf(kind, schema)}
                    maxLength={schema.maxLength}
                    dir={kind === "url" ? "ltr" : undefined}
                  />
                </FormControl>
              ) : null}
              <FormMessage />
            </FormItem>
          )}
        />
      );
  }
}
