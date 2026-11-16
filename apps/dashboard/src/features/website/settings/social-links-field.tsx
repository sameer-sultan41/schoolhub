"use client";

import { useTranslations } from "next-intl";
import { useFieldArray, type UseFormReturn } from "react-hook-form";
import {
  Button,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@schoolhub/ui";
import { Plus, Trash2 } from "lucide-react";

import type { SiteSettingsFormValues } from "./site-settings-schema";

/**
 * The site's social links: a platform name and an `https://` link (or a path on the site) per
 * row, added and removed. Each input shows its own error, so `social_links.1.url` from the API
 * lands under the second link.
 */
export function SocialLinksField({ form }: { form: UseFormReturn<SiteSettingsFormValues> }) {
  const t = useTranslations("website.settings.social");
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "social_links" });

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-foreground">{t("title")}</legend>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      {fields.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <ol className="space-y-3">
        {fields.map((field, index) => (
          <li
            key={field.id}
            aria-label={t("row", { index: index + 1 })}
            className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[1fr_2fr_auto] sm:items-start"
          >
            <FormField
              control={form.control}
              name={`social_links.${index}.platform`}
              render={({ field: input }) => (
                <FormItem>
                  <FormLabel>{t("platform")}</FormLabel>
                  <FormControl>
                    <Input {...input} placeholder={t("platformPlaceholder")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`social_links.${index}.url`}
              render={({ field: input }) => (
                <FormItem>
                  <FormLabel>{t("url")}</FormLabel>
                  <FormControl>
                    <Input {...input} dir="ltr" inputMode="url" placeholder="https://" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="button"
              variant="ghost"
              mode="icon"
              className="sm:mt-7"
              aria-label={t("remove", { index: index + 1 })}
              title={t("remove", { index: index + 1 })}
              onClick={() => {
                remove(index);
              }}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          append({ platform: "", url: "" });
        }}
      >
        <Plus aria-hidden="true" />
        {t("add")}
      </Button>
    </fieldset>
  );
}
