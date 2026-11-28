"use client";

import { useTranslations } from "next-intl";
import { useWatch, type UseFormReturn } from "react-hook-form";
import {
  FormControl,
  FormDescription,
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
} from "@schoolhub/ui";

import { enumLabel } from "@/lib/enum-label";
import type { NavigationTargetType, WebsitePageRecord } from "@/services";
import {
  NAV_LABEL_MAX,
  NAV_PAGE_TARGET,
  NAV_URL_TARGET,
  NAVIGATION_TARGET_TYPES,
} from "@/services/modules/website/navigation-menus/navigation-menus-constant";
import type { MenuFormValues } from "./navigation-model";

/** Each target type's label key under `website.navigation` (L32). */
export const TARGET_TYPE_LABEL_KEY: Readonly<Record<NavigationTargetType, string>> = {
  page: "targetTypes.page",
  url: "targetTypes.url",
  news_index: "targetTypes.news_index",
  events_index: "targetTypes.events_index",
  gallery_index: "targetTypes.gallery_index",
};

/** A link's path in the menu form: `items.0` or `items.0.children.1`. */
export type LinkPath = `items.${number}` | `items.${number}.children.${number}`;

export interface MenuLinkFieldsProps {
  form: UseFormReturn<MenuFormValues>;
  name: LinkPath;
  /** The published pages a page link may point at. */
  pages: readonly WebsitePageRecord[];
}

/**
 * One link's label and target: a published page, a link (`https://` or a path on the site), or
 * one of the news, events and gallery listings, which take no target. A page link kept from
 * before its page was unpublished still shows, marked, so the menu can be saved unchanged (the
 * server keeps an unchanged target) or pointed elsewhere. Each input shows its own error.
 */
export function MenuLinkFields({ form, name, pages }: MenuLinkFieldsProps) {
  const t = useTranslations("website.navigation");
  const targetType = useWatch({ control: form.control, name: `${name}.target_type` });
  const target = useWatch({ control: form.control, name: `${name}.target` });
  const isStalePage =
    targetType === NAV_PAGE_TARGET && target !== "" && !pages.some((page) => page.id === target);
  const pageHint = isStalePage
    ? t("stalePageHint")
    : pages.length === 0
      ? t("noPublishedPages")
      : null;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <FormField
        control={form.control}
        name={`${name}.label`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("fields.label")}</FormLabel>
            <FormControl>
              <Input {...field} maxLength={NAV_LABEL_MAX} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={`${name}.target_type`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("fields.targetType")}</FormLabel>
            <Select
              value={field.value}
              onValueChange={(value) => {
                field.onChange(value);
                form.setValue(`${name}.target`, "", { shouldDirty: true });
              }}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {NAVIGATION_TARGET_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {enumLabel(t, TARGET_TYPE_LABEL_KEY, type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      {targetType === NAV_PAGE_TARGET ? (
        <FormField
          control={form.control}
          name={`${name}.target`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("fields.page")}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={t("pagePlaceholder")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {isStalePage ? (
                    <SelectItem value={field.value}>{t("stalePage")}</SelectItem>
                  ) : null}
                  {pages.map((page) => (
                    <SelectItem key={page.id} value={page.id}>
                      {page.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {pageHint ? <FormDescription>{pageHint}</FormDescription> : null}
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}
      {targetType === NAV_URL_TARGET ? (
        <FormField
          control={form.control}
          name={`${name}.target`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("fields.url")}</FormLabel>
              <FormControl>
                <Input {...field} dir="ltr" inputMode="url" placeholder="https://" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}
    </div>
  );
}
