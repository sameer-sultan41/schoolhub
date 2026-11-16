"use client";

import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import {
  Alert,
  AlertDescription,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Switch,
} from "@schoolhub/ui";

import { SchemaFields } from "@/features/website/shared/schema-fields";
import type { SectionsFormValues } from "./sections-model";
import type { SectionTypes } from "./use-active-theme";

export interface SectionEditorProps {
  form: UseFormReturn<SectionsFormValues>;
  index: number;
  /** The section's client key: keys its fields, so a late upload never lands in another. */
  sectionKey: string;
  sectionType: string;
  types: SectionTypes;
  label: string;
  /** A server error about the whole section (its type, or a path no input fits). */
  message?: string;
  readOnly: boolean;
}

/**
 * The selected section's inputs, generated from its theme schema (`SchemaFields`, decision 12),
 * plus whether it shows on the page. A type the active theme doesn't declare is kept as it is
 * and can only be removed. Read-only for a viewer without `website.page.update`.
 */
export function SectionEditor({
  form,
  index,
  sectionKey,
  sectionType,
  types,
  label,
  message,
  readOnly,
}: SectionEditorProps) {
  const t = useTranslations("website.pages.editor");
  const schema = types[sectionType]?.schema;

  return (
    <fieldset disabled={readOnly} className="min-w-0 space-y-4">
      <legend className="text-base font-semibold">{label}</legend>
      {message ? (
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      <FormField
        control={form.control}
        name={`sections.${index}.is_visible`}
        render={({ field }) => (
          <FormItem>
            <div className="flex items-center justify-between gap-3">
              <FormLabel>{t("visible")}</FormLabel>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
      {schema ? (
        <SchemaFields
          key={sectionKey}
          form={form}
          schema={schema}
          name={`sections.${index}.content`}
        />
      ) : (
        <div className="space-y-1 rounded-md border border-border p-3">
          <p className="text-sm font-medium">{t("unsupported.title")}</p>
          <p className="text-sm text-muted-foreground">{t("unsupported.description")}</p>
        </div>
      )}
    </fieldset>
  );
}
