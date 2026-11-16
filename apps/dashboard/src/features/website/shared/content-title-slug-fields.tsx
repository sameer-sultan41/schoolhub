"use client";

import { useTranslations } from "next-intl";
import type { FieldValues, Path, PathValue, UseFormReturn } from "react-hook-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@schoolhub/ui";

import { CONTENT_SLUG_MAX, CONTENT_TITLE_MAX, slugify } from "./content-fields";

export interface ContentTitleSlugFieldsProps<T extends FieldValues> {
  /** A form whose values hold `title` and `slug` strings. */
  form: UseFormReturn<T>;
  /** The public path the slug sits under, e.g. `/news/`. */
  pathPrefix: string;
  /** On create, typing the title fills the slug until the slug is edited by hand. An existing
   * record keeps its address unless the slug is changed on purpose. */
  autoSlug: boolean;
}

/** The title and the public address (slug) of a news post, event or album. */
export function ContentTitleSlugFields<T extends FieldValues>({
  form,
  pathPrefix,
  autoSlug,
}: ContentTitleSlugFieldsProps<T>) {
  const t = useTranslations("website.content.fields");
  const titleName = "title" as Path<T>;
  const slugName = "slug" as Path<T>;

  return (
    <>
      <FormField
        control={form.control}
        name={titleName}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("title")}</FormLabel>
            <FormControl required>
              <Input
                {...field}
                maxLength={CONTENT_TITLE_MAX}
                onChange={(event) => {
                  field.onChange(event);
                  if (autoSlug && !form.getFieldState(slugName).isDirty) {
                    form.setValue(slugName, slugify(event.target.value) as PathValue<T, Path<T>>);
                  }
                }}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={slugName}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("slug")}</FormLabel>
            <FormControl required>
              <Input {...field} maxLength={CONTENT_SLUG_MAX} dir="ltr" />
            </FormControl>
            <FormDescription>{t("slugHint", { prefix: pathPrefix })}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
